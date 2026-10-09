#!/usr/bin/env node
/**
 * @file scripts/capture-screenshots.js
 * @description Upgraded SVG screenshot synthesiser for v2.5.0 release polish.
 *
 * Why SVG (still) instead of a real headless renderer?
 *   - The real game is canvas-2D and depends on `requestAnimationFrame`,
 *     `localStorage`, the Web Audio API and gamepad polling. Driving that
 *     from `node-canvas` + `jsdom` would need roughly half a browser stubbed
 *     out — which contradicts our "zero runtime deps" promise.
 *   - A hand-built SVG composition captures the same "what does this scene
 *     look like" intent in ~100 lines per scene and renders crisply at any
 *     zoom inside GitHub's README, under 20 KB each.
 *   - Real PNG captures still take precedence: drop `mainmenu.png` next to
 *     `mainmenu.svg` and re-point the README links.
 *
 * Compared to `docs/generate-screenshots.js` (v2.5.0 baseline), this version:
 *   - Spawns **100+ enemy "dots"** per gameplay scene (was 18–30).
 *   - Renders **2–3 distinct weapon effects** simultaneously (whip arc,
 *     projectile volley, frost nova ring, boomerang trail, orbit shards).
 *   - Adds a **particle layer** (hit sparks, exp-orb halos, smoke).
 *   - Adds **proper HUD chrome**: weapon slots, passive slots, minimap
 *     stub, timer/level pills, exp bar with level digit, boss HP bar.
 *   - Uses a deterministic seeded RNG so re-runs are byte-identical
 *     (helpful for PR diffs).
 *
 * Usage: `node scripts/capture-screenshots.js` (idempotent, overwrites).
 *
 * Output: docs/screenshots/{mainmenu,gameplay-early,boss-fight,levelup,
 *         gameover,achievements}.svg
 */
'use strict';

const fs = require('fs');
const path = require('path');

const W = 1200;
const H = 800;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Tiny deterministic RNG so diffs stay readable between reruns.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Reusable atoms
// ---------------------------------------------------------------------------
function svgOpen(extra = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${extra}>`;
}

function defs(extra = '') {
    return `<defs>
        <radialGradient id="bgCool" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#1a2344"/>
            <stop offset="100%" stop-color="#05070f"/>
        </radialGradient>
        <radialGradient id="bgWarm" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#3a0e1c"/>
            <stop offset="100%" stop-color="#0a0510"/>
        </radialGradient>
        <radialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#9cd6ff" stop-opacity="0.7"/>
            <stop offset="60%" stop-color="#44aaff" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#44aaff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="frostRing" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#aefbff" stop-opacity="0"/>
            <stop offset="78%" stop-color="#aefbff" stop-opacity="0.9"/>
            <stop offset="100%" stop-color="#aefbff" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="hpGrad" x1="0" x2="1">
            <stop offset="0%" stop-color="#ff7d9c"/>
            <stop offset="100%" stop-color="#ff3355"/>
        </linearGradient>
        <linearGradient id="expGrad" x1="0" x2="1">
            <stop offset="0%" stop-color="#7df4d3"/>
            <stop offset="100%" stop-color="#3ad0aa"/>
        </linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        ${extra}
    </defs>`;
}

function gridOverlay(step = 50, color = '#1b2235', opacity = 0.35) {
    const parts = [];
    for (let x = 0; x <= W; x += step) {
        parts.push(
            `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${color}" stroke-width="1" opacity="${opacity}"/>`
        );
    }
    for (let y = 0; y <= H; y += step) {
        parts.push(
            `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${color}" stroke-width="1" opacity="${opacity}"/>`
        );
    }
    return parts.join('');
}

function hero(x, y) {
    return `
        <circle cx="${x}" cy="${y}" r="60" fill="url(#heroGlow)"/>
        <circle cx="${x}" cy="${y}" r="20" fill="#44aaff"/>
        <circle cx="${x}" cy="${y}" r="11" fill="#cfeaff"/>
        <circle cx="${x - 4}" cy="${y - 4}" r="3" fill="#ffffff"/>`;
}

function enemyDot(x, y, r = 11, color = '#ff4444') {
    // Tiny but still readable: body + highlight.
    return (
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"/>` +
        `<circle cx="${(x - r * 0.35).toFixed(1)}" cy="${(y - r * 0.35).toFixed(1)}" r="${(r * 0.35).toFixed(1)}" fill="rgba(255,255,255,0.3)"/>`
    );
}

function expOrb(x, y) {
    return (
        `<circle cx="${x}" cy="${y}" r="5" fill="#7df4d3"/>` +
        `<circle cx="${x}" cy="${y}" r="10" fill="#7df4d3" opacity="0.2"/>`
    );
}

function hitSpark(x, y, rng) {
    const rays = [];
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + rng() * 0.3;
        const len = 6 + rng() * 6;
        rays.push(
            `<line x1="${x}" y1="${y}" x2="${(x + Math.cos(a) * len).toFixed(1)}" y2="${(y + Math.sin(a) * len).toFixed(1)}" stroke="#ffe066" stroke-width="1.5" opacity="0.8"/>`
        );
    }
    return rays.join('');
}

function smoke(x, y, rng) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const r = 6 + rng() * 10;
        parts.push(
            `<circle cx="${(x + (rng() - 0.5) * 14).toFixed(1)}" cy="${(y + (rng() - 0.5) * 14).toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(180,180,200,${0.12 + rng() * 0.15})"/>`
        );
    }
    return parts.join('');
}

function boss(x, y) {
    return `
        <circle cx="${x}" cy="${y}" r="110" fill="#330000" opacity="0.45"/>
        <circle cx="${x}" cy="${y}" r="70" fill="#aa0033"/>
        <circle cx="${x}" cy="${y}" r="40" fill="#ff5577"/>
        <circle cx="${x - 8}" cy="${y - 8}" r="18" fill="#ffccd9"/>
        <circle cx="${x + 20}" cy="${y - 14}" r="6" fill="#ffffff"/>
        <circle cx="${x - 22}" cy="${y + 6}" r="6" fill="#ffffff"/>`;
}

// ---- Full HUD chrome (weapon slots, passive slots, timer, level, HP/exp) ---
function hud({
    level = 7,
    time = '03:42',
    kills = 412,
    hp = '59/100',
    hpFrac = 0.59,
    expFrac = 0.42,
    weapons = ['⚔', '✦', '❄', '↺'],
    passives = ['♥', '⚡', '🧲']
} = {}) {
    const out = [];
    // top bar
    out.push(`<rect x="0" y="0" width="${W}" height="56" fill="rgba(0,0,0,0.6)"/>`);
    out.push(
        `<text x="24" y="36" font-family="monospace" font-size="20" fill="#cfeaff">LV ${level}</text>`
    );
    out.push(
        `<text x="110" y="36" font-family="monospace" font-size="20" fill="#cfeaff">⏱ ${time}</text>`
    );
    out.push(
        `<text x="240" y="36" font-family="monospace" font-size="20" fill="#cfeaff">☠ ${kills}</text>`
    );
    // HP bar
    out.push(`<rect x="380" y="18" width="220" height="16" rx="4" fill="rgba(255,255,255,0.12)"/>`);
    out.push(
        `<rect x="380" y="18" width="${(220 * hpFrac).toFixed(0)}" height="16" rx="4" fill="url(#hpGrad)"/>`
    );
    out.push(
        `<text x="610" y="31" font-family="monospace" font-size="13" fill="#ffe6ec">HP ${hp}</text>`
    );
    // Exp bar
    out.push(`<rect x="380" y="38" width="220" height="8" rx="3" fill="rgba(255,255,255,0.12)"/>`);
    out.push(
        `<rect x="380" y="38" width="${(220 * expFrac).toFixed(0)}" height="8" rx="3" fill="url(#expGrad)"/>`
    );
    // FPS chip
    out.push(
        `<rect x="${W - 120}" y="14" width="96" height="30" rx="6" fill="rgba(0,0,0,0.5)" stroke="#2a3450"/>`
    );
    out.push(
        `<text x="${W - 72}" y="34" text-anchor="middle" font-family="monospace" font-size="14" fill="#7df4d3">60 fps</text>`
    );
    // Weapon slots (bottom-left)
    weapons.forEach((ic, i) => {
        const x = 20 + i * 54;
        out.push(
            `<rect x="${x}" y="${H - 70}" width="48" height="48" rx="8" fill="rgba(10,20,40,0.75)" stroke="#3a5dbb" stroke-width="1.5"/>`
        );
        out.push(
            `<text x="${x + 24}" y="${H - 38}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#ffe066">${ic}</text>`
        );
        out.push(
            `<rect x="${x + 4}" y="${H - 26}" width="40" height="3" fill="#ffe066" opacity="0.8"/>`
        );
    });
    // Passive slots (bottom-right)
    passives.forEach((ic, i) => {
        const x = W - 70 - i * 54;
        out.push(
            `<rect x="${x}" y="${H - 70}" width="48" height="48" rx="8" fill="rgba(10,20,40,0.75)" stroke="#7d9aff" stroke-width="1.5"/>`
        );
        out.push(
            `<text x="${x + 24}" y="${H - 38}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#9ecaff">${ic}</text>`
        );
    });
    // Minimap stub (bottom-centre)
    out.push(
        `<rect x="${W / 2 - 72}" y="${H - 70}" width="144" height="48" rx="6" fill="rgba(10,15,30,0.7)" stroke="#2a3450"/>`
    );
    out.push(`<circle cx="${W / 2}" cy="${H - 46}" r="4" fill="#44aaff"/>`);
    // minimap enemy dots
    for (let i = 0; i < 30; i++) {
        const rng = mulberry32(i * 31 + 7);
        const mx = W / 2 - 60 + rng() * 120;
        const my = H - 66 + rng() * 40;
        out.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="1.6" fill="#ff4466"/>`);
    }
    return out.join('');
}

// ---------------------------------------------------------------------------
// Scene: Main menu
// ---------------------------------------------------------------------------
function mainmenu() {
    const rng = mulberry32(1);
    const sparks = [];
    for (let i = 0; i < 60; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const r = 0.4 + rng() * 1.4;
        sparks.push(
            `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#cfeaff" opacity="${(0.2 + rng() * 0.5).toFixed(2)}"/>`
        );
    }
    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgCool)"/>`,
        gridOverlay(),
        sparks.join(''),
        `<text x="${W / 2}" y="220" text-anchor="middle" font-family="Impact, sans-serif" font-size="130" fill="#cfeaff" letter-spacing="8">SURVIVOR</text>`,
        `<text x="${W / 2}" y="268" text-anchor="middle" font-family="monospace" font-size="20" fill="#7d9aff" letter-spacing="3">vampire-survivors style roguelite · zero deps</text>`,
        ...['Start Run', 'Speedrun', 'Leaderboard', 'Achievements', 'Settings'].map((label, i) => {
            const y = 340 + i * 68;
            const selected = i === 0;
            return `
                <rect x="${W / 2 - 180}" y="${y}" width="360" height="54" rx="10" fill="${selected ? '#2a3e76' : '#1d2a4a'}" stroke="${selected ? '#ffe066' : '#3a5dbb'}" stroke-width="${selected ? 2 : 1}"/>
                <text x="${W / 2}" y="${y + 35}" text-anchor="middle" font-family="sans-serif" font-size="22" fill="${selected ? '#ffe066' : '#cfeaff'}">${label}</text>`;
        }),
        // Hero silhouette bottom-left to show the game is about something
        hero(160, H - 160),
        // Version footer + social hints
        `<text x="40" y="${H - 24}" font-family="monospace" font-size="14" fill="#506080">v2.5.0 · MIT</text>`,
        `<text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-family="monospace" font-size="14" fill="#506080">github.com/ricardo-foundry/canvas-vampire-survivors</text>`,
        `<text x="${W - 40}" y="${H - 24}" text-anchor="end" font-family="monospace" font-size="14" fill="#506080">⌨ ↑↓ + Enter</text>`,
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Scene: Early gameplay — 110+ enemies, whip + projectile + orbit + frost nova
// ---------------------------------------------------------------------------
function gameplayEarly() {
    const rng = mulberry32(42);
    const cx = W / 2;
    const cy = H / 2;
    const bits = [];

    // ---- Enemy swarm: 110 dots approaching from the right/top in ragged bands
    const enemyColors = ['#ff4444', '#cc5577', '#aa3344', '#ff6688'];
    for (let i = 0; i < 110; i++) {
        // biased towards the right half, arcing around the hero
        const angle = -Math.PI * 0.55 + rng() * Math.PI * 1.0;
        const radius = 180 + rng() * 380;
        const jx = (rng() - 0.5) * 20;
        const jy = (rng() - 0.5) * 20;
        const x = cx + Math.cos(angle) * radius + jx;
        const y = cy + Math.sin(angle) * radius + jy;
        if (x < -20 || x > W + 20 || y < 60 || y > H - 80) continue;
        const size = 8 + Math.floor(rng() * 5);
        const col = enemyColors[Math.floor(rng() * enemyColors.length)];
        bits.push(enemyDot(x, y, size, col));
    }

    // ---- Weapon effect 1: Whip arc (yellow) sweeping right
    bits.push(
        `<path d="M ${cx + 20} ${cy - 6} q 90 -50 200 10" stroke="#ffe066" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.92"/>`
    );
    bits.push(
        `<path d="M ${cx + 20} ${cy - 6} q 90 -50 200 10" stroke="#fff6c4" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.95"/>`
    );

    // ---- Weapon effect 2: Magic Bolts (projectile volley)
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI * 0.1 + (i / 6) * Math.PI * 0.9;
        const r = 110 + i * 30;
        const bx = cx + Math.cos(a) * r;
        const by = cy + Math.sin(a) * r;
        bits.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="6" fill="#c080ff"/>`);
        // trail
        bits.push(
            `<circle cx="${(bx - Math.cos(a) * 14).toFixed(1)}" cy="${(by - Math.sin(a) * 14).toFixed(1)}" r="3" fill="#c080ff" opacity="0.5"/>`
        );
    }

    // ---- Weapon effect 3: Orbit shards around player
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const ox = cx + Math.cos(a) * 72;
        const oy = cy + Math.sin(a) * 72;
        bits.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="7" fill="#88ddff"/>`);
        bits.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="3" fill="#ffffff"/>`);
    }

    // ---- Particle layer: hit sparks on contact + exp orb halos + dust
    for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const r = 60 + rng() * 200;
        bits.push(hitSpark(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng));
    }
    for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        const r = 40 + rng() * 220;
        bits.push(expOrb(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const r = 80 + rng() * 260;
        bits.push(smoke(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng));
    }

    // ---- Floating damage text
    const dmgs = [
        { x: cx + 180, y: cy - 70, n: 12 },
        { x: cx + 120, y: cy + 60, n: 18 },
        { x: cx - 40, y: cy - 120, n: 9 },
        { x: cx - 140, y: cy + 40, n: 'CRIT 24!' }
    ];
    for (const d of dmgs) {
        bits.push(
            `<text x="${d.x}" y="${d.y}" font-family="sans-serif" font-size="18" fill="#ffe066" font-weight="bold">${d.n}</text>`
        );
    }

    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgCool)"/>`,
        gridOverlay(),
        bits.join(''),
        hero(cx, cy),
        hud({ level: 7, time: '03:42', kills: 412, hp: '59/100', hpFrac: 0.59, expFrac: 0.42 }),
        `<rect x="${W / 2 - 160}" y="70" width="320" height="30" rx="6" fill="rgba(170,50,90,0.4)" stroke="#aa3366"/>`,
        `<text x="${W / 2}" y="92" text-anchor="middle" font-family="monospace" font-size="15" fill="#ffcfe0" letter-spacing="2">WAVE 5 — ZOMBIE + BAT + SPITTER</text>`,
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Scene: Boss fight — 140 enemies + boss + multiple effects + dense HUD
// ---------------------------------------------------------------------------
function bossFight() {
    const rng = mulberry32(99);
    const cx = W / 2 - 80;
    const cy = H / 2 + 60;
    const bx = W / 2 + 240;
    const by = H / 2 - 50;
    const bits = [];

    // Enemy swarm, 140 dots
    for (let i = 0; i < 140; i++) {
        const angle = rng() * Math.PI * 2;
        const r = 170 + rng() * 360;
        const x = cx + Math.cos(angle) * r + (rng() - 0.5) * 20;
        const y = cy + Math.sin(angle) * r + (rng() - 0.5) * 20;
        if (x < -20 || x > W + 20 || y < 60 || y > H - 80) continue;
        const size = 7 + Math.floor(rng() * 4);
        bits.push(enemyDot(x, y, size, '#aa3344'));
    }

    // Frost Nova ring expanding from player
    bits.push(
        `<circle cx="${cx}" cy="${cy}" r="140" fill="none" stroke="url(#frostRing)" stroke-width="16" opacity="0.8"/>`
    );
    bits.push(
        `<circle cx="${cx}" cy="${cy}" r="140" fill="none" stroke="#aefbff" stroke-width="2" opacity="0.9"/>`
    );
    // Frost particles on the ring
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const px = cx + Math.cos(a) * 140;
        const py = cy + Math.sin(a) * 140;
        bits.push(
            `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#ffffff" opacity="0.9"/>`
        );
    }

    // Boomerang trail (curved)
    bits.push(
        `<path d="M ${cx + 20} ${cy - 20} q 140 -120 260 -10 q 80 40 -40 80" stroke="#ffaa55" stroke-width="3" fill="none" opacity="0.7" stroke-dasharray="4 6"/>`
    );
    bits.push(`<circle cx="${cx + 220}" cy="${cy - 90}" r="9" fill="#ff9944"/>`);

    // Enemy projectiles from boss
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = 140;
        bits.push(
            `<circle cx="${(bx + Math.cos(a) * r).toFixed(1)}" cy="${(by + Math.sin(a) * r).toFixed(1)}" r="6" fill="#ffdd66"/>`
        );
    }

    // Orbit shards
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.7;
        bits.push(
            `<circle cx="${(cx + Math.cos(a) * 74).toFixed(1)}" cy="${(cy + Math.sin(a) * 74).toFixed(1)}" r="7" fill="#88ddff"/>`
        );
    }

    // Hit sparks + smoke around boss
    for (let i = 0; i < 22; i++) {
        const a = rng() * Math.PI * 2;
        const r = 30 + rng() * 130;
        bits.push(hitSpark(bx + Math.cos(a) * r, by + Math.sin(a) * r, rng));
    }
    for (let i = 0; i < 12; i++) {
        const a = rng() * Math.PI * 2;
        const r = 60 + rng() * 180;
        bits.push(smoke(bx + Math.cos(a) * r, by + Math.sin(a) * r, rng));
    }

    // Floating crit damage
    bits.push(
        `<text x="${bx - 10}" y="${by - 80}" font-family="sans-serif" font-size="22" fill="#ff7777" font-weight="bold">CRIT 184!</text>`
    );

    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgWarm)"/>`,
        gridOverlay(50, '#2a0e18', 0.35),
        bits.join(''),
        boss(bx, by),
        hero(cx, cy),
        // Boss banner
        `<rect x="0" y="90" width="${W}" height="60" fill="rgba(170,0,40,0.65)"/>`,
        `<rect x="0" y="88" width="${W}" height="2" fill="#ff4477"/>`,
        `<rect x="0" y="150" width="${W}" height="2" fill="#ff4477"/>`,
        `<text x="${W / 2}" y="130" text-anchor="middle" font-family="Impact, sans-serif" font-size="34" fill="#ffe6ec" letter-spacing="6">A BOSS APPROACHES — VOID LORD</text>`,
        // Boss HP bar bottom
        `<rect x="${W / 2 - 220}" y="${H - 150}" width="440" height="18" rx="4" fill="rgba(0,0,0,0.6)" stroke="#552233"/>`,
        `<rect x="${W / 2 - 218}" y="${H - 148}" width="${(440 * 0.62).toFixed(0)}" height="14" rx="3" fill="url(#hpGrad)"/>`,
        `<text x="${W / 2}" y="${H - 112}" text-anchor="middle" font-family="monospace" font-size="14" fill="#ffcfe0">VOID LORD — 620 / 1000</text>`,
        hud({
            level: 14,
            time: '05:07',
            kills: 1284,
            hp: '42/120',
            hpFrac: 0.35,
            expFrac: 0.78,
            weapons: ['⚔', '✦', '❄', '↺', '⊙'],
            passives: ['♥', '⚡', '🧲', '🛡']
        }),
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Scene: Level-up overlay (with faint gameplay behind it)
// ---------------------------------------------------------------------------
function levelup() {
    const rng = mulberry32(7);
    const faded = [];
    // faint enemies + player through the dim overlay
    for (let i = 0; i < 100; i++) {
        const a = rng() * Math.PI * 2;
        const r = 140 + rng() * 380;
        const x = W / 2 + Math.cos(a) * r;
        const y = H / 2 + Math.sin(a) * r;
        if (x < 0 || x > W || y < 60 || y > H - 80) continue;
        faded.push(enemyDot(x, y, 8, '#553344'));
    }
    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgCool)"/>`,
        gridOverlay(),
        faded.join(''),
        hero(W / 2, H / 2),
        `<rect width="${W}" height="${H}" fill="rgba(0,0,0,0.7)"/>`,
        `<text x="${W / 2}" y="180" text-anchor="middle" font-family="Impact, sans-serif" font-size="68" fill="#ffe066" letter-spacing="4">LEVEL UP!</text>`,
        `<text x="${W / 2}" y="220" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#cfeaff">Choose an upgrade — ↑↓ / click / tap</text>`,
        ...[
            { name: 'Whip', desc: 'Damage +25%', tier: 'Lv 3 → 4', icon: '⚔', tag: 'weapon' },
            {
                name: 'Frost Nova',
                desc: 'New weapon — AoE + slow',
                tier: 'NEW',
                icon: '❄',
                tag: 'weapon',
                highlight: true
            },
            {
                name: 'Magnet',
                desc: 'Pickup range +30%',
                tier: 'Lv 2 → 3',
                icon: '🧲',
                tag: 'passive'
            }
        ].map((c, i) => {
            const x = 170 + i * 300;
            const highlight = c.highlight;
            return `
                <rect x="${x}" y="300" width="260" height="320" rx="14" fill="${highlight ? '#2a2450' : '#1d2a4a'}" stroke="${highlight ? '#ffe066' : '#3a5dbb'}" stroke-width="${highlight ? 3 : 2}"/>
                <rect x="${x + 20}" y="320" width="80" height="22" rx="4" fill="${c.tag === 'weapon' ? '#3a5dbb' : '#6b4a8c'}"/>
                <text x="${x + 60}" y="337" text-anchor="middle" font-family="monospace" font-size="13" fill="#cfeaff">${c.tag.toUpperCase()}</text>
                <circle cx="${x + 130}" cy="420" r="50" fill="#3a5dbb"/>
                <text x="${x + 130}" y="438" text-anchor="middle" font-family="sans-serif" font-size="46" fill="#ffe066">${c.icon}</text>
                <text x="${x + 130}" y="510" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#ffe066" font-weight="bold">${c.name}</text>
                <text x="${x + 130}" y="538" text-anchor="middle" font-family="monospace" font-size="14" fill="#7d9aff">${c.tier}</text>
                <text x="${x + 130}" y="574" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#cfeaff">${c.desc}</text>
                <rect x="${x + 40}" y="590" width="180" height="14" rx="3" fill="rgba(255,255,255,0.08)"/>
                <rect x="${x + 40}" y="590" width="${(180 * (i + 1) * 0.22).toFixed(0)}" height="14" rx="3" fill="#7df4d3"/>`;
        }),
        // Footer hint
        `<text x="${W / 2}" y="680" text-anchor="middle" font-family="monospace" font-size="13" fill="#7d9aff">press [1] [2] [3] or click a card · [R] to reroll (1 left)</text>`,
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Scene: Game over — stats + speedrun splits + retry CTA
// ---------------------------------------------------------------------------
function gameover() {
    const rng = mulberry32(31);
    // Faint battlefield behind the overlay
    const faded = [];
    for (let i = 0; i < 80; i++) {
        const a = rng() * Math.PI * 2;
        const r = 200 + rng() * 380;
        const x = W / 2 + Math.cos(a) * r;
        const y = H / 2 + Math.sin(a) * r;
        faded.push(enemyDot(x, y, 6, '#3a1a20'));
    }
    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgWarm)"/>`,
        gridOverlay(50, '#2a0e18', 0.3),
        faded.join(''),
        `<rect width="${W}" height="${H}" fill="rgba(0,0,0,0.6)"/>`,
        `<text x="${W / 2}" y="180" text-anchor="middle" font-family="Impact, sans-serif" font-size="110" fill="#ff4444" letter-spacing="8">YOU DIED</text>`,
        `<text x="${W / 2}" y="220" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#cfeaff">— final rank #3 on this build —</text>`,
        // Stats card
        `<rect x="${W / 2 - 260}" y="260" width="520" height="320" rx="14" fill="#1d2a4a" stroke="#3a5dbb" stroke-width="2"/>`,
        ...[
            ['Survived', '08:42'],
            ['Kills', '1,284'],
            ['Level', '23'],
            ['Damage dealt', '284,512'],
            ['Best build', 'Whip · Orbit · Frost Nova']
        ].map((row, i) => {
            const y = 308 + i * 48;
            return `
                <text x="${W / 2 - 230}" y="${y}" font-family="sans-serif" font-size="18" fill="#7d9aff">${row[0]}</text>
                <text x="${W / 2 + 230}" y="${y}" text-anchor="end" font-family="monospace" font-size="20" fill="#cfeaff">${row[1]}</text>`;
        }),
        `<text x="${W / 2}" y="562" text-anchor="middle" font-family="monospace" font-size="14" fill="#7df4d3">★ NO-HIT RUN · ★ EARLY EVOLVE · +2 achievements unlocked</text>`,
        // Speedrun splits strip
        `<rect x="${W / 2 - 260}" y="598" width="520" height="60" rx="10" fill="rgba(0,0,0,0.4)" stroke="#2a3450"/>`,
        `<text x="${W / 2 - 240}" y="620" font-family="monospace" font-size="12" fill="#506080">SPLITS</text>`,
        ...['1:00', '3:00', '5:00', '7:30', '10:00'].map((s, i) => {
            const x = W / 2 - 220 + i * 110;
            const reached = i < 4;
            return `
                <text x="${x}" y="644" font-family="monospace" font-size="13" fill="${reached ? '#7df4d3' : '#506080'}">${s}</text>
                <text x="${x}" y="664" font-family="monospace" font-size="11" fill="${reached ? '#cfeaff' : '#3a4560'}">${reached ? '✓' : '—'}</text>`;
        }),
        // Buttons
        `<rect x="${W / 2 - 200}" y="690" width="180" height="54" rx="10" fill="#3a5dbb"/>`,
        `<text x="${W / 2 - 110}" y="725" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#ffffff" font-weight="bold">Retry</text>`,
        `<rect x="${W / 2 + 20}" y="690" width="180" height="54" rx="10" fill="#1d2a4a" stroke="#3a5dbb" stroke-width="2"/>`,
        `<text x="${W / 2 + 110}" y="725" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#cfeaff">Main Menu</text>`,
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Scene: Achievements grid (12 cards)
// ---------------------------------------------------------------------------
function achievements() {
    const items = [
        { i: '🩸', n: 'First Blood', d: 'Defeat 1 enemy', got: true },
        { i: '⚔', n: 'Centurion', d: 'Defeat 100 enemies', got: true },
        { i: '👑', n: 'Boss Slayer', d: 'Kill a boss', got: true },
        { i: '🌪', n: 'Storm Survivor', d: 'Survive 10 minutes', got: true },
        { i: '⏱', n: '5 Minutes', d: 'Reach 5:00', got: true },
        { i: '⏱', n: '10 Minutes', d: 'Reach 10:00', got: false },
        { i: '🛡', n: 'No-Hit Boss', d: 'Beat a boss unhit', got: false },
        { i: '🔮', n: 'Max All', d: 'Max every weapon slot', got: false },
        { i: '⚡', n: 'Speed Demon', d: 'Finish Speedrun < 15m', got: true },
        { i: '🧪', n: 'Triple Build', d: '3 distinct builds seen', got: false },
        { i: '🔱', n: 'Early Evolve', d: 'Evolve before 7:00', got: true },
        { i: '🧘', n: 'Zen 5min', d: 'Move <5% over 5 min', got: false }
    ];
    return [
        svgOpen(),
        defs(),
        `<rect width="${W}" height="${H}" fill="url(#bgCool)"/>`,
        gridOverlay(),
        `<rect width="${W}" height="${H}" fill="rgba(0,0,0,0.55)"/>`,
        `<text x="${W / 2}" y="88" text-anchor="middle" font-family="Impact, sans-serif" font-size="44" fill="#ffe066" letter-spacing="4">ACHIEVEMENTS · 7 / 12</text>`,
        // Progress bar
        `<rect x="${W / 2 - 200}" y="108" width="400" height="8" rx="3" fill="rgba(255,255,255,0.1)"/>`,
        `<rect x="${W / 2 - 200}" y="108" width="${((400 * 7) / 12).toFixed(0)}" height="8" rx="3" fill="#ffe066"/>`,
        ...items.map((a, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const x = 90 + col * 258;
            const y = 170 + row * 190;
            return `
                <rect x="${x}" y="${y}" width="228" height="168" rx="14" fill="${a.got ? '#1d2a4a' : '#13182a'}" stroke="${a.got ? '#ffe066' : '#2a3450'}" stroke-width="2"/>
                <circle cx="${x + 114}" cy="${y + 54}" r="30" fill="${a.got ? 'rgba(255,224,102,0.14)' : 'rgba(80,96,128,0.1)'}"/>
                <text x="${x + 114}" y="${y + 66}" text-anchor="middle" font-family="sans-serif" font-size="36" fill="${a.got ? '#ffe066' : '#3a4560'}">${a.got ? a.i : '🔒'}</text>
                <text x="${x + 114}" y="${y + 106}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="${a.got ? '#cfeaff' : '#5a6a85'}" font-weight="bold">${a.got ? a.n : '???'}</text>
                <text x="${x + 114}" y="${y + 126}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${a.got ? '#7d9aff' : '#3a4560'}">${a.got ? a.d : 'Locked'}</text>
                <text x="${x + 114}" y="${y + 150}" text-anchor="middle" font-family="monospace" font-size="10" fill="${a.got ? '#7df4d3' : '#3a4560'}">${a.got ? 'UNLOCKED' : 'LOCKED'}</text>`;
        }),
        `<text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-family="monospace" font-size="13" fill="#7d9aff">Esc to return · L to toggle language</text>`,
        '</svg>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------
const SCENES = {
    'mainmenu.svg': mainmenu(),
    'gameplay-early.svg': gameplayEarly(),
    'boss-fight.svg': bossFight(),
    'levelup.svg': levelup(),
    'gameover.svg': gameover(),
    'achievements.svg': achievements()
};

let written = 0;
for (const [name, body] of Object.entries(SCENES)) {
    const out = path.join(OUT, name);
    fs.writeFileSync(out, body, 'utf8');
    written++;
    console.log(
        `wrote ${path.relative(process.cwd(), out)} (${(body.length / 1024).toFixed(1)} KB)`
    );
}
console.log(`\n${written} screenshot mockups generated in ${path.relative(process.cwd(), OUT)}`);
