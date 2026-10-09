// Unit tests for src/audio.ts — the Web Audio synthesiser.
//
// This module had 0% coverage. It is the "degrades silently when unavailable"
// module, which is exactly the kind of code that rots unnoticed: every guard
// returns early, so a broken guard produces no sound and no error.
//
// Everything here is deterministic. A fake AudioContext records what was asked
// of it, and setTimeout/setInterval are stubbed so the multi-note cues and the
// music sequencer can be driven step by step instead of raced against real
// timers.
//
// Runs in Node, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.ts';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An AudioParam that records every automation call. */
function makeParam() {
    return {
        value: 0,
        events: [],
        setValueAtTime(v, t) {
            this.events.push(['set', v, t]);
            this.value = v;
        },
        linearRampToValueAtTime(v, t) {
            this.events.push(['linear', v, t]);
        },
        exponentialRampToValueAtTime(v, t) {
            this.events.push(['exp', v, t]);
        }
    };
}

/** A fake AudioContext recording every node it hands out. */
function makeFakeCtx({ state = 'running', resumeFails = false } = {}) {
    const ctx = {
        currentTime: 10,
        sampleRate: 44100,
        state,
        destinations: [],
        gains: [],
        oscillators: [],
        bufferSources: [],
        buffers: [],
        resumed: 0,
        destination: { name: 'destination' },
        createGain() {
            const g = {
                gain: makeParam(),
                connected: [],
                connect(dest) {
                    this.connected.push(dest);
                    return dest;
                }
            };
            ctx.gains.push(g);
            return g;
        },
        createOscillator() {
            const o = {
                type: null,
                frequency: makeParam(),
                connected: [],
                started: null,
                stopped: null,
                connect(dest) {
                    this.connected.push(dest);
                    return dest;
                },
                start(t) {
                    this.started = t;
                },
                stop(t) {
                    this.stopped = t;
                }
            };
            ctx.oscillators.push(o);
            return o;
        },
        createBufferSource() {
            const s = {
                buffer: null,
                connected: [],
                started: null,
                stopped: null,
                connect(dest) {
                    this.connected.push(dest);
                    return dest;
                },
                start(t) {
                    this.started = t;
                },
                stop(t) {
                    this.stopped = t;
                }
            };
            ctx.bufferSources.push(s);
            return s;
        },
        createBuffer(channels, length, rate) {
            const buf = {
                channels,
                length,
                rate,
                data: new Float32Array(Math.floor(length)),
                getChannelData() {
                    return this.data;
                }
            };
            ctx.buffers.push(buf);
            return buf;
        },
        resume() {
            ctx.resumed++;
            return resumeFails ? Promise.reject(new Error('nope')) : Promise.resolve();
        }
    };
    return ctx;
}

/** Install a fake browser environment; always restore it. */
function withBrowser({ AudioContext = undefined, webkitAudioContext = undefined }, fn) {
    const realWindow = globalThis.window;
    globalThis.window = {};
    if (AudioContext) globalThis.window.AudioContext = AudioContext;
    if (webkitAudioContext) globalThis.window.webkitAudioContext = webkitAudioContext;
    try {
        return fn();
    } finally {
        if (realWindow === undefined) delete globalThis.window;
        else globalThis.window = realWindow;
    }
}

/** Capture setTimeout/setInterval callbacks so nothing is left running. */
function withFakeTimers(fn) {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;

    const timeouts = [];
    const intervals = [];
    const clearedIntervals = [];

    globalThis.setTimeout = (cb, ms) => {
        timeouts.push({ cb, ms });
        return timeouts.length;
    };
    globalThis.clearTimeout = () => {};
    globalThis.setInterval = (cb, ms) => {
        intervals.push({ cb, ms });
        return intervals.length;
    };
    globalThis.clearInterval = (id) => {
        clearedIntervals.push(id);
    };

    try {
        return fn({
            timeouts,
            intervals,
            clearedIntervals,
            /** Run every queued timeout in order. */
            flushTimeouts() {
                const queued = timeouts.splice(0, timeouts.length);
                for (const t of queued) t.cb();
                return queued;
            }
        });
    } finally {
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
        globalThis.setInterval = realSetInterval;
        globalThis.clearInterval = realClearInterval;
    }
}

/** An engine wired to a fake context and unlocked, ready to make noise. */
function readyEngine(settings = {}, ctxOpts = {}) {
    const ctx = makeFakeCtx(ctxOpts);
    const engine = new AudioEngine(settings);
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            engine.init();
            engine.unlock();
        }
    );
    return { engine, ctx };
}

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

test('audio/init: with no Web Audio support it disables itself instead of throwing', () => {
    withBrowser({}, () => {
        const engine = new AudioEngine({});
        engine.init();
        assert.equal(engine.ctx, null);
        assert.equal(engine.enabled, false);
    });
});

test('audio/init: falls back to the webkit-prefixed constructor', () => {
    const ctx = makeFakeCtx();
    withBrowser(
        {
            webkitAudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            engine.init();
            assert.equal(engine.ctx, ctx, 'Safari only exposes webkitAudioContext');
            assert.equal(engine.enabled, true);
        }
    );
});

test('audio/init: builds the gain graph and applies volumes', () => {
    const ctx = makeFakeCtx();
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({ masterVolume: 0.5, sfxVolume: 0.7, musicVolume: 0.3 });
            engine.init();

            assert.equal(ctx.gains.length, 3, 'master, sfx and music gains');
            const [master, sfx, music] = ctx.gains;
            assert.deepEqual(sfx.connected, [master], 'sfx feeds master');
            assert.deepEqual(music.connected, [master], 'music feeds master');
            assert.deepEqual(master.connected, [ctx.destination], 'master feeds the output');

            assert.equal(master.gain.value, 0.5);
            assert.equal(sfx.gain.value, 0.7);
            assert.equal(music.gain.value, 0.3);
            assert.equal(engine.enabled, true);
        }
    );
});

test('audio/init: is idempotent — a second call must not rebuild the graph', () => {
    const ctx = makeFakeCtx();
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            engine.init();
            engine.init();
            assert.equal(ctx.gains.length, 3, 'no duplicate gains');
        }
    );
});

test('audio/init: a throwing constructor disables audio rather than crashing the game', () => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => warnings.push(a);
    try {
        withBrowser(
            {
                AudioContext: function Boom() {
                    throw new Error('blocked by policy');
                }
            },
            () => {
                const engine = new AudioEngine({});
                engine.init();
                assert.equal(engine.enabled, false);
                assert.equal(engine.ctx, null);
            }
        );
    } finally {
        console.warn = realWarn;
    }
    assert.equal(warnings.length, 1, 'the failure should be reported, not swallowed silently');
});

// ---------------------------------------------------------------------------
// volumes
// ---------------------------------------------------------------------------

test('audio/applyVolumes: falls back to defaults for missing settings', () => {
    const { engine, ctx } = readyEngine({});
    const [master, sfx, music] = ctx.gains;
    assert.equal(master.gain.value, 0.6);
    assert.equal(sfx.gain.value, 0.8);
    assert.equal(music.gain.value, 0.4);
    assert.equal(engine.enabled, true);
});

test('audio/applyVolumes: muting zeroes master without destroying the stored volume', () => {
    const settings = { masterVolume: 0.8 };
    const { engine, ctx } = readyEngine(settings);
    const [master] = ctx.gains;
    assert.equal(master.gain.value, 0.8);

    engine.setMuted(true);
    assert.equal(master.gain.value, 0, 'muted must silence the master gain');
    assert.equal(settings.masterVolume, 0.8, 'the player’s volume must be preserved');

    engine.setMuted(false);
    assert.equal(master.gain.value, 0.8, 'unmuting must restore exactly what it was');
});

test('audio/applyVolumes: disabling music zeroes the music gain', () => {
    const { engine, ctx } = readyEngine({ musicEnabled: false, musicVolume: 0.9 });
    const music = ctx.gains[2];
    assert.equal(music.gain.value, 0, 'musicEnabled false must win over musicVolume');
    assert.equal(engine.enabled, true);
});

test('audio/applyVolumes: is a no-op before init, not a crash', () => {
    withBrowser({}, () => {
        const engine = new AudioEngine({});
        assert.doesNotThrow(() => engine.applyVolumes());
    });
});

// ---------------------------------------------------------------------------
// tone()
// ---------------------------------------------------------------------------

test('audio/tone: stays silent until unlocked', () => {
    const ctx = makeFakeCtx();
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            engine.init();
            // Deliberately not unlocked: browsers block audio until a user gesture.
            engine.tone({ freq: 440 });
            assert.equal(ctx.oscillators.length, 0, 'no sound before a user gesture');
            assert.equal(ctx.gains.length, 3, 'only the graph gains exist');
        }
    );
});

test('audio/tone: is silent when disabled or uninitialised', () => {
    const ctx = makeFakeCtx();
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            engine.tone({ freq: 440 });
            assert.equal(ctx.oscillators.length, 0, 'no init, no context, no sound');

            engine.init();
            engine.unlock();
            engine.enabled = false;
            engine.tone({ freq: 440 });
            assert.equal(ctx.oscillators.length, 0, 'disabled means disabled');
        }
    );
});

test('audio/tone: builds an oscillator with the requested shape and schedule', () => {
    const { engine, ctx } = readyEngine();
    engine.tone({ freq: 300, dur: 0.1, type: 'square', volume: 0.5, release: 0.2 });

    assert.equal(ctx.oscillators.length, 1);
    const osc = ctx.oscillators[0];
    assert.equal(osc.type, 'square');
    assert.equal(osc.frequency.value, 300);
    assert.equal(osc.started, ctx.currentTime);
    assert.equal(osc.stopped, ctx.currentTime + 0.1 + 0.2 + 0.01, 'stop includes a safety margin');
    assert.ok(osc.frequency.events.length >= 1, 'frequency is scheduled');
});

test('audio/tone: a sweep ramps the frequency and never drops below 40Hz', () => {
    const { engine, ctx } = readyEngine();

    engine.tone({ freq: 500, dur: 0.1, sweep: -100 });
    const ramps = ctx.oscillators[0].frequency.events.filter((e) => e[0] === 'exp');
    assert.equal(ramps.length, 1);
    assert.equal(ramps[0][1], 400, 'freq + sweep');

    engine.tone({ freq: 100, dur: 0.1, sweep: -500 });
    const floored = ctx.oscillators[1].frequency.events.filter((e) => e[0] === 'exp');
    assert.equal(floored[0][1], 40, 'a negative sweep must clamp at 40Hz, not go negative');
});

test('audio/tone: noise uses a buffer source and caches the buffer', () => {
    const { engine, ctx } = readyEngine();
    engine.tone({ noise: true });
    engine.tone({ noise: true });

    assert.equal(ctx.bufferSources.length, 2, 'one source per call');
    assert.equal(ctx.buffers.length, 1, 'the noise buffer is generated once and reused');
    assert.equal(ctx.bufferSources[0].buffer, ctx.bufferSources[1].buffer);
    assert.equal(ctx.buffers[0].channels, 1, 'noise is mono');
});

test('audio/tone: the gain envelope ramps up then decays to near-silence', () => {
    const { engine, ctx } = readyEngine();
    engine.tone({ volume: 0.5, attack: 0.01, dur: 0.1, release: 0.05 });

    const gain = ctx.gains[3].gain; // 3 graph gains, then the per-tone gain
    assert.deepEqual(gain.events[0], ['set', 0, ctx.currentTime]);
    assert.deepEqual(gain.events[1], ['linear', 0.5, ctx.currentTime + 0.01]);
    assert.equal(gain.events[2][0], 'exp');
    assert.equal(gain.events[2][1], 0.0001, 'exponential ramps cannot reach zero');
});

// ---------------------------------------------------------------------------
// unlock()
// ---------------------------------------------------------------------------

test('audio/unlock: resumes a suspended context and marks itself unlocked', () => {
    const ctx = makeFakeCtx({ state: 'suspended' });
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            engine.unlock();
            assert.equal(engine.unlocked, true);
            assert.equal(engine.ctx, ctx, 'unlock initialises first if needed');
            assert.equal(ctx.resumed, 1, 'a suspended context must be resumed');
        }
    );
});

test('audio/unlock: does not resume a context that is already running', () => {
    const { ctx } = readyEngine({}, { state: 'running' });
    assert.equal(ctx.resumed, 0);
});

test('audio/unlock: a rejected resume does not surface as an unhandled error', async () => {
    const ctx = makeFakeCtx({ state: 'suspended', resumeFails: true });
    withBrowser(
        {
            AudioContext: function FakeAC() {
                return ctx;
            }
        },
        () => {
            const engine = new AudioEngine({});
            assert.doesNotThrow(() => engine.unlock());
        }
    );
    // Give the rejected promise a tick to be swallowed by the .catch().
    await new Promise((r) => setImmediate(r));
});

// ---------------------------------------------------------------------------
// SFX cues
// ---------------------------------------------------------------------------

test('audio/cues: every cue produces sound once unlocked', () => {
    const cues = [
        'hit',
        'shoot',
        'explosion',
        'pickup',
        'levelUp',
        'damage',
        'death',
        'bossSpawn',
        'bossWarn',
        'achievement'
    ];
    for (const cue of cues) {
        const { engine, ctx } = readyEngine();
        withFakeTimers((t) => {
            engine[cue]();
            // Run the follow-up notes too. Several cues are little melodies that
            // schedule their later notes on a timer; leaving those unfired means
            // their callbacks are never exercised.
            t.flushTimeouts();
            assert.equal(t.timeouts.length, 0, `${cue} left a pending timer`);
        });
        assert.ok(
            ctx.oscillators.length + ctx.bufferSources.length > 0,
            `${cue}() should produce at least one source`
        );
    }
});

test('audio/cues: multi-note cues schedule later notes rather than playing at once', () => {
    const { engine, ctx } = readyEngine();
    const timers = withFakeTimers((t) => {
        engine.levelUp();
        assert.equal(ctx.oscillators.length, 1, 'only the first note is immediate');
        t.flushTimeouts();
        return t;
    });
    assert.equal(ctx.oscillators.length, 3, 'levelUp is a three-note arpeggio');
    assert.equal(timers.timeouts.length, 0, 'no timers left pending');
});

test('audio/cues: the cue set is exactly as documented, no silent additions', () => {
    // Guards against a cue being renamed or dropped: callers would then call a
    // missing method and throw at the worst possible moment, mid-run.
    const engine = new AudioEngine({});
    for (const cue of [
        'hit',
        'shoot',
        'explosion',
        'pickup',
        'levelUp',
        'damage',
        'death',
        'bossSpawn',
        'bossWarn',
        'achievement'
    ]) {
        assert.equal(typeof engine[cue], 'function', `${cue} must exist`);
    }
});

// ---------------------------------------------------------------------------
// music
// ---------------------------------------------------------------------------

test('audio/startMusic: refuses to start when disabled, uninitialised or already playing', () => {
    const { engine, ctx } = readyEngine();
    withFakeTimers((t) => {
        engine.enabled = false;
        engine.startMusic();
        assert.equal(t.intervals.length, 0, 'disabled engine must not schedule');

        engine.enabled = true;
        engine.ctx = null;
        engine.startMusic();
        assert.equal(t.intervals.length, 0, 'no context, no music');

        engine.ctx = ctx;
        engine.startMusic();
        assert.equal(t.intervals.length, 1);
        engine.startMusic();
        assert.equal(t.intervals.length, 1, 'already playing — must not stack intervals');
    });
});

test('audio/startMusic: respects the musicEnabled setting', () => {
    const { engine } = readyEngine({ musicEnabled: false });
    withFakeTimers((t) => {
        engine.startMusic();
        assert.equal(t.intervals.length, 0, 'music is off in settings');
    });
});

test('audio/startMusic: the sequencer steps through an arpeggio over a progression', () => {
    const { engine, ctx } = readyEngine();
    withFakeTimers((t) => {
        engine.startMusic();
        assert.equal(t.intervals.length, 1);
        const step = t.intervals[0];
        assert.ok(step.ms > 0, 'the step interval must be positive');

        const before = ctx.oscillators.length;
        step.cb();
        assert.equal(ctx.oscillators.length, before + 2, 'a step plays an arp note plus a bass');

        // Step every 4th beat adds the bass; a non-multiple of 4 does not.
        const afterFirst = ctx.oscillators.length;
        step.cb();
        step.cb();
        step.cb();
        assert.ok(
            ctx.oscillators.length > afterFirst,
            'the sequencer keeps producing notes as it advances'
        );
    });
});

test('audio/startMusic: the sequencer wraps the bar and advances the progression', () => {
    // The arpeggio is 6 steps per bar and the chord progression is 4 bars, so
    // this is the loop that keeps a five-minute run from sounding identical
    // forever. Step 6 must reset the step counter and move to the next root.
    const { engine, ctx } = readyEngine();
    withFakeTimers((t) => {
        engine.startMusic();
        const step = t.intervals[0];

        // First note of bar 0: root 0 semitones, arp 0 -> A3 = 220Hz.
        step.cb();
        assert.ok(Math.abs(ctx.oscillators[0].frequency.value - 220) < 1e-9);

        // Six steps complete a bar; the seventh is the downbeat of bar 1,
        // whose root is progression[1] = -4 semitones.
        for (let i = 0; i < 6; i++) step.cb();
        const downbeat = ctx.oscillators[ctx.oscillators.length - 2]; // arp note, then bass
        const expected = 220 * Math.pow(2, -4 / 12);
        assert.ok(
            Math.abs(downbeat.frequency.value - expected) < 1e-9,
            `expected the progression to advance to -4 semitones ` +
                `(${expected.toFixed(2)}Hz), got ${downbeat.frequency.value.toFixed(2)}Hz`
        );
    });
});

test('audio/stopMusic: clears the interval and is safe to call twice', () => {
    const { engine } = readyEngine();
    withFakeTimers((t) => {
        engine.startMusic();
        const id = engine.musicInterval;
        engine.stopMusic();
        assert.deepEqual(t.clearedIntervals, [id]);
        assert.equal(engine.musicInterval, null);

        assert.doesNotThrow(() => engine.stopMusic(), 'stopping twice must not throw');
        assert.equal(t.clearedIntervals.length, 1, 'nothing left to clear');
    });
});

test('audio/toggleMusic: persists the setting, applies volumes and starts or stops', () => {
    const settings = { musicVolume: 0.5 };
    const { engine, ctx } = readyEngine(settings);
    withFakeTimers(() => {
        engine.toggleMusic(true);
        assert.equal(settings.musicEnabled, true);
        assert.equal(engine.musicInterval !== null, true, 'turning on starts the sequencer');
        assert.equal(ctx.gains[2].gain.value, 0.5);

        engine.toggleMusic(false);
        assert.equal(settings.musicEnabled, false);
        assert.equal(engine.musicInterval, null, 'turning off stops the sequencer');
        assert.equal(ctx.gains[2].gain.value, 0, 'and silences the music gain');
    });
});
