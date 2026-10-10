/**
 * @module spatial-hash
 * @description Uniform-grid spatial hash for 2D broad-phase collision queries.
 * Insertion is O(1) per item (bucket push) and range queries are O(k) in the
 * number of items in the overlapping cells — a dramatic improvement over the
 * O(n²) pairwise scan that the game used in v1.x. Cell size is tuned to be
 * ~2× the largest common entity diameter so a single-cell probe usually
 * suffices. The module is decoupled from game types: buckets just store
 * whatever object you hand them, as long as each has numeric `.x` and `.y`.
 *
 * Layered on top of this class, `src/systems.ts` re-exports a thin wrapper
 * tuned for enemies. This file is the authoritative implementation and is
 * the one exercised by the unit tests.
 *
 * Dependencies: none.
 *
 * Exports:
 *   - class SpatialHash
 */

/**
 * A uniform-grid spatial index, GENERIC over what it holds.
 *
 * The generic is the whole point, and it replaces two failed attempts. A
 * structural `{ x, y }` was tried first and broke five call sites, because
 * `main.ts` reads `.size`, `.hp` and `.takeDamage` off what comes back. Typing it
 * as `Enemy` directly would have fixed those and hard-coded the hash to one kind
 * of entity. A generic says what is true: the hash indexes anything positioned,
 * and the CALLER says which.
 */
export class SpatialHash<T extends { x: number; y: number }> {
    /** Bucket edge length in world units. */
    declare cell: number;
    /** Bucket key -> objects currently in that bucket. */
    declare map: Map<string, T[]>;
    /** Number of objects inserted; bucket arrays are not counted. */
    declare _size: number;
    /**
     * @param {number} cell - cell edge length in world units (px). 64 is a
     *     good default for this game: matches the biggest non-boss enemy
     *     bounding box so most queries hit a single cell.
     */
    constructor(cell = 64) {
        this.cell = cell;
        this.map = new Map<string, T[]>();
        this._size = 0;
    }

    /** Empty every bucket. Cheap and allocation-free. */
    clear() {
        this.map.clear();
        this._size = 0;
    }

    get size() {
        return this._size;
    }

    _key(x: number, y: number) {
        return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
    }

    /**
     * Insert a single item. The caller owns the item reference; the hash just
     * indexes it for fast neighbour lookup. Items are NOT de-duplicated.
     */
    insert(item: T) {
        const k = this._key(item.x, item.y);
        let bucket = this.map.get(k);
        if (!bucket) {
            bucket = [];
            this.map.set(k, bucket);
        }
        bucket.push(item);
        this._size++;
    }

    /** Bulk-insert after a `clear()`. */
    insertAll(items: T[]) {
        this.clear();
        for (const it of items) this.insert(it);
    }

    /** @deprecated alias kept for backwards compatibility with v2.x callers. */
    insertEnemies(enemies: T[]) {
        this.insertAll(enemies);
    }

    /**
     * Iterate every item whose cell overlaps the square `(x±r, y±r)`. Results
     * may include items further than `r` from the query centre — callers must
     * do the exact distance check. The generator yields each item at most
     * once (cells don't overlap by construction).
     *
     * iter-16 perf: returns a plain array instead of a generator. V8 inlines
     * tight `for (const e of arr)` loops aggressively, and avoiding the
     * generator suspend/resume bookkeeping is measurably faster on hot
     * weapon-fire paths (Lightning's chain hops alone can call this dozens
     * of times per fire). Callers that destructure to `[...sh.queryRect()]`
     * still work because Array is iterable.
     */
    queryRect(x: number, y: number, r: number) {
        const c = this.cell;
        const x0 = Math.floor((x - r) / c);
        const x1 = Math.floor((x + r) / c);
        const y0 = Math.floor((y - r) / c);
        const y1 = Math.floor((y + r) / c);
        const out: T[] = [];
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const b = this.map.get(`${gx},${gy}`);
                if (b) {
                    for (let i = 0; i < b.length; i++) out.push(b[i]);
                }
            }
        }
        return out;
    }

    /**
     * Return the single closest item within `maxRange` (Euclidean distance),
     * or `null` if no bucket is populated within the search square.
     */
    findNearest(x: number, y: number, maxRange: number) {
        let best: T | null = null;
        let bestD = maxRange;
        for (const e of this.queryRect(x, y, maxRange)) {
            const d = Math.hypot(e.x - x, e.y - y);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /** Alias used throughout `weapons.ts`/`entities.ts`. */
    findNearestEnemy(x: number, y: number, maxRange: number) {
        return this.findNearest(x, y, maxRange);
    }

    /** Count cells currently holding at least one item (for diagnostics). */
    occupiedCellCount() {
        return this.map.size;
    }
}
