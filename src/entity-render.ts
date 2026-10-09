/**
 * @module entity-render
 * @description Canvas drawing for the entity classes in `./entities.ts`.
 *
 * Rendering is deliberately not a method on the entities. They own simulation —
 * position, health, timers, collision — and nothing else, so the simulation can
 * be reasoned about, tested and ported without a canvas existing at all. Each
 * function here takes the drawing context explicitly and the entity as a plain
 * argument.
 *
 * This is the seam a GDScript port replaces wholesale: the simulation
 * translates directly, and the drawing is reimplemented against Godot's
 * CanvasItem API instead of a 2D context.
 */

import type {
    Enemy,
    Player,
    EnemyProjectile,
    Projectile,
    OrbitShard,
    Mine,
    ExpOrb,
    Particle,
    FloatingText
} from './entities.ts';

export function renderEnemyProjectile(ctx: CanvasRenderingContext2D, self: EnemyProjectile) {
    ctx.save();
    ctx.fillStyle = '#ff44aa';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function renderProjectile(ctx: CanvasRenderingContext2D, self: Projectile) {
    ctx.save();
    ctx.translate(self.x, self.y);
    ctx.rotate(self.angle);
    switch (self.id) {
        case 'knife':
            ctx.fillStyle = '#e0e6ee';
            ctx.fillRect(-12, -2, 24, 4);
            break;
        case 'magic_wand':
            ctx.fillStyle = '#aa66ff';
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.arc(-2, -2, 2.2, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'axe':
            ctx.fillStyle = '#b0b5b8';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.stroke();
            break;
        case 'cross':
            ctx.fillStyle = '#fff3a0';
            ctx.fillRect(-10, -3, 20, 6);
            ctx.fillRect(-3, -10, 6, 20);
            break;
        case 'fire_wand':
            ctx.fillStyle = '#ff6600';
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffcc00';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
        default:
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
    }
    ctx.restore();
}

export function renderOrbitShard(ctx: CanvasRenderingContext2D, self: OrbitShard) {
    ctx.save();
    const g = ctx.createRadialGradient(self.x, self.y, 0, self.x, self.y, 14);
    g.addColorStop(0, 'rgba(255,240,180,0.85)');
    g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(self.x, self.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath();
    ctx.arc(self.x, self.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function renderMine(ctx: CanvasRenderingContext2D, self: Mine) {
    const armed = self.fuse < self.maxFuse * 0.5;
    const pulse = armed ? 0.5 + Math.sin(performance.now() / 60) * 0.5 : 0.3;
    ctx.save();
    ctx.fillStyle = `rgba(255,80,80,${0.25 + pulse * 0.35})`;
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = armed ? '#ff4444' : '#aa4444';
    ctx.beginPath();
    ctx.arc(self.x, self.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

export function renderExpOrb(ctx: CanvasRenderingContext2D, self: ExpOrb) {
    const a = self.life < 2 ? Math.max(0, self.life / 2) : 1;
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(self.x, self.y, 0, self.x, self.y, self.size * 2.2);
    g.addColorStop(0, 'rgba(100,180,255,0.55)');
    g.addColorStop(1, 'rgba(100,180,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7ab8ff';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function renderParticle(ctx: CanvasRenderingContext2D, self: Particle) {
    if (self.life <= 0) return;
    ctx.globalAlpha = Math.max(0, self.life);
    ctx.fillStyle = self.color;
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

export function renderFloatingText(ctx: CanvasRenderingContext2D, self: FloatingText) {
    if (self.life <= 0) return;
    ctx.globalAlpha = Math.max(0, self.life);
    ctx.fillStyle = self.color;
    const sz = self.crit ? self.size * 1.6 : self.size;
    ctx.font = `${self.weight} ${sz}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    if (self.crit) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText(self.text, self.x, self.y);
    }
    ctx.fillText(self.text, self.x, self.y);
    ctx.globalAlpha = 1;
}

export function renderPlayer(ctx: CanvasRenderingContext2D, self: Player) {
    // Don't make the player fully disappear during i-frames: strobe alpha.
    const strobe = self.invincible ? (Math.floor(performance.now() / 60) % 2 === 0 ? 0.4 : 1) : 1;
    ctx.save();
    ctx.globalAlpha = strobe;

    const grad = ctx.createRadialGradient(self.x, self.y, 0, self.x, self.y, self.size * 2.2);
    grad.addColorStop(0, 'rgba(100,200,255,0.35)');
    grad.addColorStop(1, 'rgba(100,200,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#44aaff';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cfeaff';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Garlic aura ring
    const garlic = self.weapons.find((w) => w.id === 'garlic');
    if (garlic) {
        const range = garlic.getRange(this);
        const t = performance.now() / 400;
        ctx.strokeStyle = `rgba(160,255,160,${0.25 + Math.sin(t) * 0.08})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(self.x, self.y, range, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

export function renderEnemy(ctx: CanvasRenderingContext2D, self: Enemy) {
    ctx.save();
    // Slowed foes get a cold cast.
    if (self.flashTimer > 0) {
        ctx.fillStyle = '#ffffff';
    } else if (self.slowTimer > 0) {
        ctx.fillStyle = '#88ccff';
    } else if (self.bomber && self.fuseArmed) {
        // Blink red while the fuse is burning.
        const blink = Math.floor(performance.now() / 120) % 2 === 0;
        ctx.fillStyle = blink ? '#ffffff' : self.color;
    } else {
        ctx.fillStyle = self.color;
    }
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(self.x, self.y, self.size * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Shield ring
    if (self.shielded && self.shieldHp > 0) {
        ctx.strokeStyle = 'rgba(160,200,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(self.x, self.y, self.size + 4, 0, Math.PI * 2);
        ctx.stroke();
    }

    // HP bar
    const pct = Math.max(0, self.hp / self.maxHp);
    const w = self.boss ? 80 : 30;
    ctx.fillStyle = '#222';
    ctx.fillRect(self.x - w / 2, self.y - self.size - 10, w, 4);
    ctx.fillStyle = pct > 0.5 ? '#44ff44' : pct > 0.25 ? '#ffaa33' : '#ff4444';
    ctx.fillRect(self.x - w / 2, self.y - self.size - 10, w * pct, 4);

    if (self.boss) {
        // iter-14: IceQueen wears a frosty cyan halo + a faint inner ring
        // so she reads as "the ice variant" at a glance even from across
        // the arena. Other bosses keep the original magenta crown.
        if (self.type?.iceQueen) {
            ctx.strokeStyle = 'rgba(170,220,255,0.85)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(self.x, self.y, self.size + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(220,240,255,0.45)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(self.x, self.y, self.size + 10, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.strokeStyle = '#ff33aa';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(self.x, self.y, self.size + 4, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    ctx.restore();
}
