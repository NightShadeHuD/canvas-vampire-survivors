/**
 * @module game-render
 * @description Canvas drawing for game-level scenery, separated from `Game`.
 *
 * `Game` owns the canvas and the frame loop, but the drawing itself lives here
 * so the simulation can be reasoned about without a rendering context. This is
 * the same seam as `./entity-render.ts`, one level up: entities no longer draw
 * themselves, and neither does the world.
 *
 * A GDScript port replaces this module against Godot's CanvasItem API and
 * keeps everything else.
 */

import { CONFIG } from './config.ts';
import {
    renderEnemy,
    renderEnemyProjectile,
    renderExpOrb,
    renderFloatingText,
    renderMine,
    renderParticle,
    renderPlayer,
    renderProjectile
} from './entity-render.ts';
import type { Game } from './main.ts';
import { getBackgroundFor } from './stages.ts';

export function drawGrid(
    ctx: CanvasRenderingContext2D /**
     * Only the fields this module draws with, declared structurally so the module
     * does not import `Game` and create a cycle with `main.ts`.
     */,
    game: {
        stageId: string;
        ctx: CanvasRenderingContext2D;
        /** Only the world-space follow target is read here. */
        camera: { worldX: number; worldY: number };
    }
) {
    const alpha = (getBackgroundFor(game.stageId).gridAlpha ?? 0.04).toFixed(3);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1;
    const size = CONFIG.GRID_SIZE;
    const cx = game.camera.worldX;
    const cy = game.camera.worldY;
    const vw = CONFIG.CANVAS_WIDTH;
    const vh = CONFIG.CANVAS_HEIGHT;
    const startX = Math.floor(cx / size) * size;
    const startY = Math.floor(cy / size) * size;
    for (let x = startX; x <= cx + vw; x += size) {
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x, cy + vh);
        ctx.stroke();
    }
    for (let y = startY; y <= cy + vh; y += size) {
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx + vw, y);
        ctx.stroke();
    }
}

/** Draw one frame: background, world pass, then screen-space effects. */
export function renderGame(ctx: CanvasRenderingContext2D, game: Game) {
    // 1) Background fill in screen space (no transform). This guarantees
    //    the viewport is always cleared even when the camera sits flush
    //    against an arena edge and a sliver would otherwise be unfilled.
    const bg = getBackgroundFor(game.stageId);
    ctx.fillStyle = bg.fill;
    ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

    // 2) World-space pass: translate by -camera + shake so entity coords
    //    (which live in arena space) project into the viewport.
    ctx.save();
    ctx.translate(-game.camera.worldX + game.camera.x, -game.camera.worldY + game.camera.y);

    drawGrid(ctx, game);

    for (const o of game.expOrbs) renderExpOrb(ctx, o);
    for (const m of game.mines) renderMine(ctx, m);
    renderEnemies(ctx, game);
    if (game.player) {
        renderPlayer(ctx, game.player);
        // Orbit shards live on the weapon, so render per-weapon extras here.
        for (const w of game.player.weapons) w.renderExtras?.(ctx);
    }
    for (const p of game.projectiles) renderProjectile(ctx, p);
    for (const ep of game.enemyProjectiles) renderEnemyProjectile(ctx, ep);
    for (const p of game.particles) renderParticle(ctx, p);
    for (const t of game.floatingTexts) renderFloatingText(ctx, t);

    ctx.restore();

    // 3) Screen-space effects (flash, pulses, vignette) on top — these
    //    render relative to the viewport, not the world.
    game.effects.render(ctx, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
}

/** Draw enemies, using the cached sprite when one is available. */
export function renderEnemies(ctx: CanvasRenderingContext2D, game: Game) {
    for (const e of game.enemies) {
        if (e.boss || e.flashTimer > 0 || e.shielded) {
            renderEnemy(ctx, e);
            continue;
        }
        const sprite = getEnemySprite(e.type, e.size);
        if (sprite) {
            ctx.drawImage(sprite, e.x - sprite.width / 2, e.y - sprite.height / 2);
            // Cheap HP bar (cached sprite can't reflect current HP).
            const pct = Math.max(0, e.hp / e.maxHp);
            if (pct < 1) {
                const w = 30;
                ctx.fillStyle = '#222';
                ctx.fillRect(e.x - w / 2, e.y - e.size - 10, w, 3);
                ctx.fillStyle = pct > 0.5 ? '#44ff44' : pct > 0.25 ? '#ffaa33' : '#ff4444';
                ctx.fillRect(e.x - w / 2, e.y - e.size - 10, w * pct, 3);
            }
        } else {
            renderEnemy(ctx, e);
        }
    }
}

function getEnemySprite(def: { id: string; color?: string }, size: number) {
    const key = spriteKey(def.id, size);
    const cached = SPRITE_CACHE.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null; // SSR / test guard
    const pad = 4;
    const d = size * 2 + pad * 2;
    const off = document.createElement('canvas');
    off.width = d;
    off.height = d;
    const ox = d / 2;
    const oy = d / 2;
    const c = off.getContext('2d');
    // A canvas can refuse a 2D context, and the type says so. Before this guard
    // the code would have thrown on `c.fillStyle`; returning null instead means
    // the caller falls back to `renderEnemy`, which is the same path already used
    // when `document` is absent. Nothing is drawn worse and nothing crashes.
    if (!c) return null;
    c.fillStyle = def.color || '#ff4444';
    c.beginPath();
    c.arc(ox, oy, size, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath();
    c.arc(ox, oy, size * 0.5, 0, Math.PI * 2);
    c.fill();
    SPRITE_CACHE.set(key, off);
    return off;
}

/** Cached offscreen sprites, keyed by enemy type and size. */
const SPRITE_CACHE = new Map();

function spriteKey(id: string, size: number) {
    return `${id}@${size}`;
}
