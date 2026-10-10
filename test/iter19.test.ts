// iter-19 tests — mobile haptics + customisable keymap.
//
// Pure-Node where possible. The few cases that need a localStorage stand-in
// install a minimal `window.localStorage` shim before requiring the keymap
// module fresh. Vibration tests inject a navigator stub through the engine's
// optional second-arg constructor — the production code paths read from
// `globalThis.navigator` lazily.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HapticEngine, VIBRATION_PATTERNS } from '../src/haptics.ts';
import {
    DEFAULT_KEYMAP,
    KEYMAP_ACTIONS,
    KEYMAP_STORAGE_KEY,
    actionForKey,
    bindKey,
    cloneKeymap,
    detectConflicts,
    keyLabel,
    loadKeymap,
    normaliseKey,
    sanitiseKeymap,
    saveKeymap,
    _resetKeymapForTests
} from '../src/keymap.ts';

// ---------------------------------------------------------------------------
// Haptics — vibrate mock, toggle gating, missing API silence.
// ---------------------------------------------------------------------------
test('iter19 haptics: vibrate fires the named pattern through navigator', () => {
    const calls = [];
    const fakeNav = {
        vibrate: (pattern) => {
            calls.push(pattern);
            return true;
        }
    };
    const eng = new HapticEngine({ vibration: true }, fakeNav);
    assert.equal(eng.isSupported(), true);
    assert.equal(eng.isEnabled(), true);

    eng.hurt();
    eng.bossSpawn();
    eng.levelUp();
    eng.gameOver();

    assert.deepEqual(calls[0], [...VIBRATION_PATTERNS.hurt]);
    assert.deepEqual(calls[1], [...VIBRATION_PATTERNS.bossSpawn]);
    assert.deepEqual(calls[2], [...VIBRATION_PATTERNS.levelUp]);
    assert.deepEqual(calls[3], [...VIBRATION_PATTERNS.gameOver]);
});

test('iter19 haptics: settings.vibration === false suppresses the host call', () => {
    const calls = [];
    const fakeNav = { vibrate: (p) => calls.push(p) };
    const settings = { vibration: false };
    const eng = new HapticEngine(settings, fakeNav);

    assert.equal(eng.isSupported(), true);
    assert.equal(eng.isEnabled(), false);
    assert.equal(eng.hurt(), true, 'returns true on supported-but-disabled');
    assert.equal(calls.length, 0, 'no host call while disabled');

    // Flip live — engine reads the setting on every fire.
    settings.vibration = true;
    eng.hurt();
    assert.equal(calls.length, 1, 'host call resumes once re-enabled');
});

test('iter19 haptics: missing navigator.vibrate is a silent no-op', () => {
    const eng = new HapticEngine({ vibration: true }, {});
    assert.equal(eng.isSupported(), false);
    assert.equal(eng.hurt(), false);
    // Unknown pattern name returns false too.
    // Deliberately not a pattern name: the runtime guard is what is under test.
    assert.equal(eng.vibrate('nope' as keyof typeof VIBRATION_PATTERNS), false);
});

test('iter19 haptics: throwing navigator.vibrate is swallowed', () => {
    let threw = false;
    const fakeNav = {
        vibrate: () => {
            threw = true;
            throw new Error('blocked by user-gesture gate');
        }
    };
    const eng = new HapticEngine({ vibration: true }, fakeNav);
    // Must not propagate.
    assert.equal(eng.hurt(), false);
    assert.equal(threw, true);
});

test('iter19 haptics: distinct pattern shapes per event', () => {
    // Sanity: every event has a unique array so a player can tell them apart.
    const seen = new Set();
    for (const name of Object.keys(VIBRATION_PATTERNS)) {
        const k = JSON.stringify(VIBRATION_PATTERNS[name]);
        assert.equal(seen.has(k), false, `pattern ${name} is not unique`);
        seen.add(k);
    }
});

// ---------------------------------------------------------------------------
// Keymap — defaults, normalise, label, bind, conflict detect.
// ---------------------------------------------------------------------------
test('iter19 keymap: defaults cover WASD + arrows + ESC + H + M', () => {
    assert.deepEqual(DEFAULT_KEYMAP.up, ['w', 'arrowup']);
    assert.deepEqual(DEFAULT_KEYMAP.down, ['s', 'arrowdown']);
    assert.deepEqual(DEFAULT_KEYMAP.left, ['a', 'arrowleft']);
    assert.deepEqual(DEFAULT_KEYMAP.right, ['d', 'arrowright']);
    assert.ok(DEFAULT_KEYMAP.pause.includes('escape'));
    assert.ok(DEFAULT_KEYMAP.help.includes('h'));
    assert.ok(DEFAULT_KEYMAP.mute.includes('m'));
});

test('iter19 keymap: normaliseKey lowercases and rejects garbage', () => {
    assert.equal(normaliseKey('W'), 'w');
    assert.equal(normaliseKey('ArrowUp'), 'arrowup');
    assert.equal(normaliseKey(''), '');
    assert.equal(normaliseKey(null), '');
    assert.equal(normaliseKey(undefined), '');
});

test('iter19 keymap: keyLabel pretty-prints control keys + arrows', () => {
    assert.equal(keyLabel('arrowup'), '↑');
    assert.equal(keyLabel('arrowleft'), '←');
    assert.equal(keyLabel('escape'), 'Esc');
    assert.equal(keyLabel(' '), 'Space');
    assert.equal(keyLabel('w'), 'W');
});

test('iter19 keymap: bindKey strips conflicts on rebind', () => {
    // Bind W to "right". Should remove W from "up" automatically so the
    // result is conflict-free.
    const next = bindKey(DEFAULT_KEYMAP, 'right', 'w');
    assert.equal(next.right.includes('w'), true);
    assert.equal(next.up.includes('w'), false, 'W is gone from up');
    // up still has arrowup to keep the action playable.
    assert.equal(next.up.includes('arrowup'), true);
    // No conflicts in the rebuilt map.
    assert.deepEqual(detectConflicts(next), []);
});

test('iter19 keymap: detectConflicts surfaces double-bound keys', () => {
    // Forge a dirty map: K bound to both up and down.
    const dirty = cloneKeymap(DEFAULT_KEYMAP);
    dirty.up = ['k'];
    dirty.down = ['k'];
    const conflicts = detectConflicts(dirty);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].key, 'k');
    assert.deepEqual(conflicts[0].actions, ['down', 'up']);
});

test('iter19 keymap: actionForKey reverse-lookup matches default + remap', () => {
    assert.equal(actionForKey(DEFAULT_KEYMAP, 'w'), 'up');
    assert.equal(actionForKey(DEFAULT_KEYMAP, 'arrowright'), 'right');
    assert.equal(actionForKey(DEFAULT_KEYMAP, 'escape'), 'pause');
    assert.equal(actionForKey(DEFAULT_KEYMAP, 'q'), null);
});

test('iter19 keymap: bindKey preserves existing default for an emptied action', () => {
    // Sanity guard: if remapping somehow leaves an action with zero keys,
    // we reset it to the default so the player can't lock themselves out.
    const start = cloneKeymap(DEFAULT_KEYMAP);
    start.mute = []; // simulate hand-edited bad save
    const next = bindKey(start, 'pause', 'escape', { replace: true });
    assert.ok(next.mute.length > 0, 'mute restored from default');
});

// ---------------------------------------------------------------------------
// Persistence — save/load roundtrip + sanitise hostile payloads.
// ---------------------------------------------------------------------------
test('iter19 keymap: save → load roundtrips through localStorage shim', () => {
    // Install a tiny localStorage shim before the keymap module touches it.
    const store = new Map();
    (globalThis as any).window = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, v),
            removeItem: (k) => store.delete(k)
        }
    };
    _resetKeymapForTests();
    try {
        const custom = bindKey(DEFAULT_KEYMAP, 'up', 'i');
        assert.equal(saveKeymap(custom), true);
        // The persisted blob is real JSON.
        const raw = store.get(KEYMAP_STORAGE_KEY);
        assert.ok(raw && typeof raw === 'string');
        const loaded = loadKeymap();
        assert.deepEqual(loaded.up, ['i'], 'custom up binding survived');
        assert.deepEqual(loaded.down, [...DEFAULT_KEYMAP.down]);
    } finally {
        delete globalThis.window;
        _resetKeymapForTests();
    }
});

test('iter19 keymap: sanitiseKeymap drops junk + falls back to defaults', () => {
    const dirty = {
        up: [123, null, 'W', 'w'], // mixed types + dupes
        bogusAction: ['z'], // unknown action ignored
        pause: [] // empty falls back to default
    };
    const safe = sanitiseKeymap(dirty);
    assert.deepEqual(safe.up, ['w'], 'lowercased + deduped');
    assert.equal(Object.prototype.hasOwnProperty.call(safe, 'bogusAction'), false);
    assert.deepEqual(safe.pause, [...DEFAULT_KEYMAP.pause]);
    // Every canonical action is represented.
    for (const action of KEYMAP_ACTIONS) {
        assert.ok(Array.isArray(safe[action]) && safe[action].length > 0);
    }
});
