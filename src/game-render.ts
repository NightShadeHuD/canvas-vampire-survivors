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
