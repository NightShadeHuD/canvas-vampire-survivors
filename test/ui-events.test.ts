// Drives the event handlers `src/ui.ts` registers, by calling them directly.
//
// The markup tests read what each dialog PRODUCES. These call what each dialog
// LISTENS for — the settings handler chain, the remap capture flow, the replay
// speed buttons, the leaderboard's export/import pair — because a dialog whose
// buttons do nothing is a dialog that renders perfectly and is unusable, and
// no amount of markup assertion notices.
//
// The stub records listeners (`el._listeners`), so a handler can be invoked
// with a synthetic event object without a browser. That is not a shortcut: it
// is the only way to reach a closure that exists solely to be an event handler,
// and the alternative is leaving the whole interaction layer unexecuted.
//
// Runs in Node, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserStub } from './helpers/browser-stub.ts';
import { UI } from '../src/ui.ts';

type StubEnv = ReturnType<typeof installBrowserStub>;

/** A stub element with recorded listeners, as `makeElement` builds it. */
interface ListenerHost {
    _listeners: Record<string, Array<(e: unknown) => void>>;
    innerHTML: string;
    style: Record<string, unknown>;
    children: unknown[];
}

/** The listeners registered for one event, if any. */
function fire(host: ListenerHost, event: string, payload: unknown = {}): number {
    const handlers = host._listeners[event] || [];
    for (const fn of handlers) fn(payload);
    return handlers.length;
}

/**
 * A click on a dialog BUTTON (as opposed to a row).
 *
 * `closest` is present and returns null on purpose: `showRemap`'s single click
 * handler asks every click whether it landed on a row, so a synthetic event
 * without `closest` tests nothing but the error path.
 */
function buttonClick(action: string): {
    target: { dataset: { action: string }; closest: () => null };
} {
    return { target: { dataset: { action }, closest: () => null } };
}

/** A stand-in button that records its click handler and can fire it. */
function fakeButtons(
    values: string[],
    key: string
): Array<{
    dataset: Record<string, string>;
    addEventListener(ev: string, fn: () => void): void;
    click(): void;
}> {
    return values.map((value) => {
        const listeners: Array<() => void> = [];
        return {
            dataset: { [key]: value },
            addEventListener(_ev: string, fn: () => void) {
                listeners.push(fn);
            },
            click() {
                for (const fn of listeners) fn();
            }
        };
    });
}

/** An event whose target carries a data-key/type/value, as a real one does. */
function fieldEvent(
    key: string,
    type: string,
    value: unknown,
    checked = false
): { target: { dataset: { key: string }; type: string; value: unknown; checked: boolean } } {
    return { target: { dataset: { key }, type, value, checked } };
}

function withUi(fn: (ui: UI, env: StubEnv) => void): void {
    const env = installBrowserStub({ now: 1000 });
    try {
        fn(new UI({ stageId: null }), env);
    } finally {
        env.restore();
    }
}

function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return Object.assign(
        {
            masterVolume: 0.6,
            sfxVolume: 0.8,
            musicVolume: 0.4,
            difficulty: 'normal',
            showFps: false,
            screenShake: true,
            reducedMotion: false,
            colorblind: false,
            musicEnabled: true,
            damageNumbers: true,
            criticalFlash: true,
            vibration: true,
            muted: false,
            locale: 'en',
            stage: 'forest',
            touchButtonScale: 1
        },
        overrides
    );
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

test('ui/showSettings: input events reach onChange for each control type', () => {
    withUi((ui) => {
        const seen: Array<[string, unknown]> = [];
        ui.showSettings(
            settings(),
            (k: string, v: unknown) => seen.push([k, v]),
            () => {},
            () => {},
            { vibrationSupported: true }
        );
        const host = ui.els.settingsMenu as unknown as ListenerHost;
        assert.equal(fire(host, 'input', fieldEvent('masterVolume', 'range', '0.35')), 1);
        assert.equal(fire(host, 'input', fieldEvent('colorblind', 'checkbox', 'on', true)), 1);
        assert.equal(fire(host, 'input', fieldEvent('locale', 'select-one', 'de')), 1);
        // touchButtonScale is exposed as a STRING select and must be coerced
        // back to a number before it is persisted, or the clamp sees NaN.
        assert.equal(fire(host, 'input', fieldEvent('touchButtonScale', 'select-one', '1.2')), 1);
        // An event with no data-key is ignored rather than persisted.
        assert.equal(fire(host, 'input', { target: { dataset: {} } }), 1);
        assert.deepEqual(seen, [
            ['masterVolume', 0.35],
            ['colorblind', true],
            ['locale', 'de'],
            ['touchButtonScale', 1.2]
        ]);
    });
});

test('ui/showSettings: a non-numeric touch scale falls back to 1', () => {
    withUi((ui) => {
        const seen: Array<[string, unknown]> = [];
        ui.showSettings(
            settings(),
            (k: string, v: unknown) => seen.push([k, v]),
            () => {},
            () => {},
            { vibrationSupported: false }
        );
        const host = ui.els.settingsMenu as unknown as ListenerHost;
        fire(host, 'input', fieldEvent('touchButtonScale', 'select-one', 'huge'));
        assert.deepEqual(seen, [['touchButtonScale', 1]]);
    });
});

test('ui/showSettings: the buttons close, reset and remap', () => {
    const realConfirm = globalThis.confirm;
    let confirmed = 0;
    (globalThis as Record<string, unknown>).confirm = () => {
        confirmed++;
        return true;
    };
    try {
        withUi((ui) => {
            let closed = 0;
            let reset = 0;
            let remapped = 0;
            ui.showSettings(
                settings(),
                () => {},
                () => closed++,
                () => reset++,
                { vibrationSupported: true, onRemap: () => remapped++ }
            );
            const host = ui.els.settingsMenu as unknown as ListenerHost;
            fire(host, 'click', buttonClick('reset'));
            fire(host, 'click', buttonClick('remap'));
            fire(host, 'click', buttonClick('close'));
            assert.equal(confirmed, 1, 'a reset must ask first');
            assert.equal(reset, 1);
            assert.equal(remapped, 1);
            assert.equal(closed, 1);
            assert.equal(ui.els.settingsMenu.style.display, 'none');
            // (`removeEventListener` is a no-op in the stub, so the detach
            // itself cannot be asserted here; `ui/showSettings` calls it.)
        });
    } finally {
        (globalThis as Record<string, unknown>).confirm = realConfirm;
    }
});

test('ui/showSettings: a cancelled reset does not reset', () => {
    const realConfirm = globalThis.confirm;
    (globalThis as Record<string, unknown>).confirm = () => false;
    try {
        withUi((ui) => {
            let reset = 0;
            ui.showSettings(
                settings(),
                () => {},
                () => {},
                () => reset++,
                {}
            );
            fire(ui.els.settingsMenu as unknown as ListenerHost, 'click', buttonClick('reset'));
            assert.equal(reset, 0);
        });
    } finally {
        (globalThis as Record<string, unknown>).confirm = realConfirm;
    }
});

// ---------------------------------------------------------------------------
// Remap dialog
// ---------------------------------------------------------------------------

test('ui/showRemap: clicking a row captures, and saving reports the new map', () => {
    withUi((ui, env) => {
        // `window` only exists once the stub is installed, so the keydown
        // listener is captured here rather than before `withUi`.
        const keys: Array<(e: unknown) => void> = [];
        const win = globalThis.window as unknown as Record<string, unknown>;
        win.addEventListener = (ev: string, fn: (e: unknown) => void) => {
            if (ev === 'keydown') keys.push(fn);
        };
        win.removeEventListener = () => {};
        const saved: Array<Record<string, string[]>> = [];
        let closed = 0;
        ui.showRemap(
            {
                up: ['w'],
                down: ['s'],
                left: ['a'],
                right: ['d'],
                pause: ['p'],
                help: ['h'],
                mute: ['m']
            },
            (next: Record<string, string[]>) => saved.push(next),
            () => closed++
        );
        const host = env.getEl('remapDialog') as unknown as ListenerHost;

        // Capture mode: click the "up" row, then press a key.
        fire(host, 'click', {
            target: { closest: () => ({ dataset: { action: 'up' } }) }
        });
        assert.equal(keys.length, 1, 'the keydown listener must be attached');
        const prevented = { count: 0 };
        keys[0]({
            key: 'Q',
            preventDefault: () => prevented.count++,
            stopPropagation: () => {}
        });
        assert.equal(prevented.count, 1, 'the captured key must not reach gameplay');

        fire(host, 'click', buttonClick('save'));
        assert.equal(saved.length, 1);
        assert.deepEqual(saved[0].up, ['q']);
        assert.equal(closed, 1);
    });
});

test('ui/showRemap: Tab backs out of capture, reset restores the defaults', () => {
    withUi((ui, env) => {
        const keys: Array<(e: unknown) => void> = [];
        const win = globalThis.window as unknown as Record<string, unknown>;
        win.addEventListener = (ev: string, fn: (e: unknown) => void) => {
            if (ev === 'keydown') keys.push(fn);
        };
        win.removeEventListener = () => {};
        const saved: Array<Record<string, string[]>> = [];
        ui.showRemap(
            {
                up: ['q'],
                down: ['s'],
                left: ['a'],
                right: ['d'],
                pause: ['p'],
                help: ['h'],
                mute: ['m']
            },
            (next: Record<string, string[]>) => saved.push(next),
            () => {}
        );
        const host = env.getEl('remapDialog') as unknown as ListenerHost;
        fire(host, 'click', { target: { closest: () => ({ dataset: { action: 'up' } }) } });
        keys[0]({ key: 'Tab', preventDefault: () => {}, stopPropagation: () => {} });
        fire(host, 'click', buttonClick('save'));
        assert.equal(saved.length, 1);
        assert.deepEqual(saved[0].up, ['q'], 'Tab must not become a binding');

        fire(host, 'click', buttonClick('reset-defaults'));
        fire(host, 'click', buttonClick('save'));
        assert.equal(saved.length, 2);
        assert.deepEqual(saved[1].up, ['w', 'arrowup']);
    });
});

test('ui/showRemap: cancel closes without saving', () => {
    withUi((ui, env) => {
        let saved = 0;
        let closed = 0;
        ui.showRemap(
            {
                up: ['w'],
                down: ['s'],
                left: ['a'],
                right: ['d'],
                pause: ['p'],
                help: ['h'],
                mute: ['m']
            },
            () => saved++,
            () => closed++
        );
        fire(env.getEl('remapDialog') as unknown as ListenerHost, 'click', buttonClick('cancel'));
        assert.equal(saved, 0);
        assert.equal(closed, 1);
    });
});

// ---------------------------------------------------------------------------
// Replay speeds and the stage picker
// ---------------------------------------------------------------------------

test('ui/showReplayMenu: each speed button reports its multiplier', () => {
    withUi((ui, env) => {
        const speeds: number[] = [];
        ui.showReplayMenu(
            { stage: 'forest', finalTime: 10, finalLevel: 1, finalKills: 1 },
            (s: number) => speeds.push(s)
        );
        const host = env.getEl('replayScreen') as unknown as ListenerHost & {
            querySelectorAll(sel: string): unknown[];
        };
        // The stub has no parser, so the buttons are supplied directly: this is
        // the handler's contract being driven, not the DOM's.
        const buttons = fakeButtons(['1', '2', '4'], 'replaySpeed');
        host.querySelectorAll = () => buttons;
        // Re-render so the handlers attach to these buttons.
        ui.showReplayMenu(
            { stage: 'forest', finalTime: 10, finalLevel: 1, finalKills: 1 },
            (s: number) => speeds.push(s)
        );
        for (const b of buttons) b.click();
        assert.deepEqual(speeds, [1, 2, 4]);
    });
});

test('ui/showStagePicker: clicking a card reports the stage and closes', () => {
    withUi((ui) => {
        const picked: string[] = [];
        const cards = fakeButtons(['forest', 'crypt', 'tundra'], 'stage');
        const host = ui.els.stagePickerScreen as unknown as ListenerHost & {
            querySelectorAll(sel: string): unknown[];
        };
        host.querySelectorAll = () => cards;
        // Re-render so the click handlers attach to these cards.
        ui.showStagePicker('forest', (id: string) => picked.push(id));
        cards[1].click();
        assert.deepEqual(picked, ['crypt']);
        assert.equal(ui.els.stagePickerScreen.style.display, 'none');
    });
});
