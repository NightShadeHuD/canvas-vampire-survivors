/**
 * @file test/helpers/browser-stub.js
 * @description A minimal, honest browser environment so `Game` can be
 * constructed and driven in Node.
 *
 * `src/main.ts` is the largest module in the repository (1,887 LOC) and had 0%
 * test coverage: `boot()` throws `document is not defined`, so no test could
 * get near it. That is not a reason to leave it untested — it is a reason to
 * build a stub, which is what this is.
 *
 * Two things make this stub worth more than a pile of no-ops:
 *
 *   1. **A controllable clock.** `performance.now()` is faked and can be
 *      advanced exactly. Pause-time accounting for the speedrun timer is
 *      arithmetic on wall-clock readings, and it was a real bug once
 *      (iter-16): paused seconds were counted against the player. Testing
 *      that needs a clock you can move by a known amount, not `setTimeout`.
 *
 *   2. **Recording elements.** `getElementById` returns a stub that records
 *      attributes, classes and text, so overlay state can be asserted rather
 *      than assumed.
 *
 * This file is deliberately NOT named `*.test.js`: it is shared infrastructure,
 * not a test, and the runner glob `test/*.test.js` must not pick it up.
 */

/** A style object that swallows CSS custom properties. */
function makeStyle() {
    return {
        setProperty() {},
        removeProperty() {},
        getPropertyValue: () => ''
    };
}

/** One stubbed DOM element that records what was done to it. */
export function makeElement(id = '') {
    const attrs = new Map();
    const classes = new Set();
    let html = '';
    const el = {
        id,
        tagName: 'DIV',
        style: makeStyle(),
        dataset: {},
        // The real DOM coerces whatever you assign into a string, so the stub
        // must too. Without this a test can assert `textContent === 1` against
        // the stub and pass, while the browser would report '1' — the stub
        // being more permissive than the thing it stands in for.
        _text: '',
        get textContent() {
            return this._text;
        },
        set textContent(v) {
            this._text = v === null || v === undefined ? '' : String(v);
        },
        children: [],
        _attrs: attrs,
        _classes: classes,
        _listeners: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, on) =>
                on === undefined ? classes.has(c) : on ? classes.add(c) : classes.delete(c),
            contains: (c) => classes.has(c)
        },
        addEventListener(ev, fn) {
            (this._listeners[ev] = this._listeners[ev] || []).push(fn);
        },
        removeEventListener() {},
        setAttribute(k, v) {
            attrs.set(k, String(v));
        },
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        hasAttribute: (k) => attrs.has(k),
        removeAttribute: (k) => attrs.delete(k),
        appendChild(c) {
            this.children.push(c);
            return c;
        },
        insertBefore(c) {
            this.children.push(c);
            return c;
        },
        removeChild(c) {
            this.children = this.children.filter((x) => x !== c);
            return c;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
        blur() {},
        click() {},
        remove() {},
        getContext: () => null,
        width: 1200,
        height: 800,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 })
    };
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set: (v) => {
            html = String(v);
            el.children.length = 0;
        }
    });
    Object.defineProperty(el, 'className', {
        get: () => [...classes].join(' '),
        set: (v) => {
            classes.clear();
            String(v)
                .split(/\s+/)
                .filter(Boolean)
                .forEach((c) => classes.add(c));
        }
    });
    return el;
}

/**
 * Install the stub environment.
 *
 * @param {{ now?: number }} [opts]
 * @returns {{ restore: () => void, clock: { now: () => number, set: (t:number)=>void, advance: (ms:number)=>void }, elements: Map<string, object>, raf: { pending: number, requested: number, cancelled: number } }}
 */
export function installBrowserStub({ now = 1000 } = {}) {
    const real = {
        document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
        window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
        navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
        performance: Object.getOwnPropertyDescriptor(globalThis, 'performance'),
        requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame'),
        cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
    };

    // --- controllable clock -------------------------------------------------
    let t = now;
    const clock = {
        now: () => t,
        set: (v) => {
            t = v;
        },
        advance: (ms) => {
            t += ms;
            return t;
        }
    };

    // --- elements -----------------------------------------------------------
    const elements = new Map();
    const getEl = (id) => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };

    // --- localStorage -------------------------------------------------------
    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() {
            return store.size;
        }
    };

    // --- animation frames ---------------------------------------------------
    const raf = { pending: 0, ids: [], cancelled: 0, requested: 0 };
    const requestAnimationFrame = () => {
        raf.requested++;
        raf.pending++;
        const id = raf.pending;
        raf.ids.push(id);
        return id;
    };
    const cancelAnimationFrame = () => {
        raf.cancelled++;
        raf.pending = Math.max(0, raf.pending - 1);
    };

    const define = (name, value) =>
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

    const documentStub = {
        getElementById: getEl,
        querySelector: () => makeElement('query'),
        querySelectorAll: () => [],
        createElement: (tag) => makeElement(tag),
        addEventListener() {},
        removeEventListener() {},
        body: makeElement('body'),
        documentElement: Object.assign(makeElement('html'), { lang: 'en' }),
        hidden: false,
        visibilityState: 'visible',
        fonts: { ready: Promise.resolve() }
    };

    const windowStub = {
        addEventListener() {},
        removeEventListener() {},
        innerWidth: 1200,
        innerHeight: 800,
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
        location: { hostname: 'localhost', protocol: 'http:', href: 'http://localhost/' },
        localStorage,
        document: documentStub,
        requestAnimationFrame,
        cancelAnimationFrame,
        performance: { now: clock.now }
    };

    define('document', documentStub);
    define('window', windowStub);
    define('navigator', { getGamepads: () => [], vibrate: () => true, userAgent: 'node' });
    define('performance', { now: clock.now });
    define('requestAnimationFrame', requestAnimationFrame);
    define('cancelAnimationFrame', cancelAnimationFrame);
    define('localStorage', localStorage);

    const restore = () => {
        for (const [name, desc] of Object.entries(real)) {
            if (desc) Object.defineProperty(globalThis, name, desc);
            else delete globalThis[name];
        }
    };

    return { restore, clock, elements, raf, getEl };
}
