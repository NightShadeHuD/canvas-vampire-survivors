#!/usr/bin/env node
/**
 * @file scripts/clock-shift.mjs
 * @description Preload that offsets the *ambient* clock, so the suite can be
 * run as if it were a different date. This is how we prove a test is hermetic
 * rather than merely passing on whatever day it happens to run.
 *
 * Only ambient time is shifted — `new Date()` with no arguments and
 * `Date.now()`. Explicit instants (`new Date('2026-04-25')`, `Date.UTC(...)`)
 * are deliberately left alone, because those are fixtures the test chose on
 * purpose, not "now".
 *
 * Usage (normally via `npm run test:clock`, which drives this):
 *   CLOCK_SHIFT_MS=157680000000 \
 *     NODE_OPTIONS="--import file://$PWD/scripts/clock-shift.mjs" \
 *     node --test test/*.test.js
 *
 * Why this exists: two tests in this repo stored a hardcoded '2026-04-25' and
 * were pruned by a real-clock 14-day window, so they passed until 2026-05-09
 * and then failed forever. Nothing in the suite could see that, because every
 * run used the one clock that still worked. Shifting the clock is the only
 * cheap way to catch a date time bomb before it goes off.
 */

const SHIFT_MS = Number(process.env.CLOCK_SHIFT_MS || 0);
const RealDate = Date;

class ShiftedDate extends RealDate {
    constructor(...args) {
        if (args.length === 0) super(RealDate.now() + SHIFT_MS);
        else super(...args);
    }

    static now() {
        return RealDate.now() + SHIFT_MS;
    }
}

if (SHIFT_MS !== 0) {
    globalThis.Date = ShiftedDate;
    const days = Math.round(SHIFT_MS / 86400000);
    process.stderr.write(`[clock-shift] ambient clock offset by ${days} days\n`);
}

export { SHIFT_MS };
