/**
 * @module systems
 * @description Cross-cutting infrastructure used by the main loop —
 * screen-shake camera and a rolling FPS meter. The spatial-hash broad phase
 * lives in `./spatial-hash.js` and is re-exported here for backwards
 * compatibility with v2.x callers.
 *
 * Dependencies: `./spatial-hash.js`.
 *
 * Exports:
 *   - class SpatialHash    re-export from ./spatial-hash.js
 *   - class ShakeCamera    cumulative shake offset
 *   - class FpsMeter       60-sample rolling average
 */

export { SpatialHash } from './spatial-hash.js';

export class ShakeCamera {
    /** Current shake magnitude. Decays at 2 units per second. */
    intensity = 0;
    /** Screen-space offset applied to this frame's render. */
    x = 0;
    y = 0;
    /**
     * World-space follow target — the top-left of the viewport in arena
     * coordinates. Set by `Game._updateCamera()` each frame.
     */
    worldX = 0;
    worldY = 0;

    shake(amount: number) {
        this.intensity = Math.max(this.intensity, amount);
    }

    update(dt: number, enabled: boolean) {
        if (!enabled || this.intensity <= 0) {
            this.x = 0;
            this.y = 0;
            this.intensity = 0;
            return;
        }
        const i = this.intensity * 12;
        this.x = (Math.random() - 0.5) * i;
        this.y = (Math.random() - 0.5) * i;
        this.intensity = Math.max(0, this.intensity - 2 * dt);
    }
}

export class FpsMeter {
    /** Frame deltas in seconds, oldest first. Capped at 60 by `tick`. */
    samples: number[] = [];
    fps = 0;

    tick(dt: number) {
        this.samples.push(dt);
        if (this.samples.length > 60) this.samples.shift();
        const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        this.fps = avg > 0 ? 1 / avg : 0;
    }
}
