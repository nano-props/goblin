// Vitest worker-side setup. Runs before any test code in every fork.
//
// Holds only concerns that cannot be expressed as per-test mocks:
//
//   1. Filter Node v25's `--localstorage-file was provided without a valid
//      path` warning. Printed at process startup before any test code runs;
//      nothing in this repo asks for the flag, but Node 25 emits it anyway.
//
//   2. Install a Storage shim on globalThis so the Zustand persist middleware
//      in `src/web/stores/repos/store.ts` (which reads `globalThis.localStorage`
//      via `getStorage()`) always finds a valid Storage, regardless of test
//      environment ordering or cross-environment pollution between jsdom
//      and node-env tests.
//
//   3. Stub `window.focus` as a no-op in jsdom. Browser notification click
//      handlers call it legitimately in production, but jsdom emits a
//      not-implemented error through its virtual console instead of behaving
//      like a browser window.
//
//   4. Stub `HTMLCanvasElement.prototype.getContext` to return null in jsdom.
//      xterm's ImageAddon pulls a 2d context for image rendering, and jsdom
//      logs "Not implemented: HTMLCanvasElement's getContext() method"
//      otherwise. Returning null is what real browsers do when canvas is
//      disabled, and the addon falls back gracefully. Per-test `vi.spyOn`
//      calls still take precedence (they run after this stub is installed).
//
//   5. Install a no-op `ResizeObserver` on `window` in jsdom. jsdom does not
//      implement it, but Radix UI's Tooltip and HoverCard mount a `use-size`
//      observer on every TooltipContent. A no-op shim is enough — those
//      components only use the observation to anchor the portal, which is
//      irrelevant in tests.
//
//   6. Component tests mount below the real entrypoint, which guarantees that
//      host info is ready before React mounts. Seed that entrypoint invariant
//      before each jsdom test; host-info tests replace it explicitly.
//
//   7. Restore jsdom's real Window before each test. Narrow transport tests
//      sometimes replace `globalThis.window` with a host facade; letting that
//      facade escape its test breaks browser lifecycle owners such as React
//      Query's focus manager.
//
//   8. Let Node-hosted zero-delay callbacks queued by jsdom component cleanup
//      finish before Vitest removes the DOM globals. This is a temporary
//      workaround for the Radix FocusScope teardown race tracked in #374.

import { afterAll, beforeEach } from 'vitest'
import { waitForNextHostTimerTurn } from '#/test-utils/jsdom-teardown.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
//
// Notes on React 18/19 act warnings:
//   Earlier revisions of this file installed a `console.error` patch to
//   swallow the "An update to <Component> inside a test was not wrapped
//   in act(...)" warnings that came from fire-and-forget `useEffect`
//   chains in `useRepoStatusRefresh`, `useClientEffectIntentRouter`,
//   `RepoWorkspaceToolbar`'s `useTerminalSessions`, and the Radix
//   portal components. The root cause turned out to be
//   `src/test-utils/render.tsx` permanently setting
//   `globalThis.IS_REACT_ACT_ENVIRONMENT = true`, which left the
//   worker in the "act environment is on but no act is running" state
//   that React 19's `warnIfUpdatesNotWrappedWithActDEV` flags on
//   every post-mount commit. `renderInJsdom` no longer permanently
//   flips that flag. Tests that need an act boundary import `act` from
//   `@testing-library/react`, whose wrapper enables the flag only for
//   the callback and restores it afterwards.

const originalEmit = process.emit.bind(process)
process.emit = function patchedEmit(event, payload, ...rest) {
  if (event === 'warning' && payload && typeof payload.message === 'string') {
    if (payload.message.includes('--localstorage-file was provided without a valid path')) {
      return false
    }
  }
  return originalEmit(event, payload, ...rest)
}

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key) {
      const value = data.get(String(key))
      return value === undefined ? null : value
    },
    key(index) {
      const keys = Array.from(data.keys())
      return index >= 0 && index < keys.length ? keys[index] : null
    },
    removeItem(key) {
      data.delete(String(key))
    },
    setItem(key, value) {
      data.set(String(key), String(value))
    },
  }
}

globalThis.localStorage = makeMemoryStorage()
globalThis.sessionStorage = makeMemoryStorage()

const jsdomWindow = typeof window === 'undefined' ? null : window

// Temporary workaround for https://github.com/nano-props/goblin/issues/374.
//
// Radix FocusScope defers its unmount autofocus work with an unqualified
// `setTimeout(..., 0)`. In Vitest's jsdom environment, `window` is mapped to
// the test global while Node's existing timer functions remain installed.
// React Testing Library can therefore unmount a FocusScope and queue its
// callback on the Node host timer immediately before Vitest closes jsdom and
// removes the DOM globals. If the callback wins that race, it observes a
// torn-down `document`/`CustomEvent` realm and produces an intermittent
// unhandled test failure.
//
// The shared helper captures the real host timer while this setup file is
// evaluated, before any test can enable fake timers. The setup-file `afterAll`
// is registered before test-file hooks; `sequence.hooks: 'stack'` in
// `vitest.config.ts` makes it run last. Crossing exactly one host timer turn
// then lets zero-delay callbacks already queued by component cleanup finish
// before environment teardown. It does not advance the fake clock or run
// unrelated pending fake timers.
//
// Remove this drain once Radix or Vitest ships and this project adopts an
// upstream fix that keeps FocusScope cleanup inside the owning DOM lifecycle;
// retain the teardown stress coverage when removing it.
afterAll(async () => {
  if (!jsdomWindow) return
  await waitForNextHostTimerTurn()
})

// Only relevant in the jsdom environment; no-op when undefined.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'focus', {
    configurable: true,
    writable: true,
    value() {},
  })
}

// Only relevant in the jsdom environment; no-op when undefined.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  }
}

// Only relevant in the jsdom environment; no-op when undefined.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = NoopResizeObserver
}

beforeEach(() => {
  if (!jsdomWindow) return
  if (globalThis.window !== jsdomWindow) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: jsdomWindow,
    })
  }
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/test', platform: 'darwin' },
    status: 'ready',
    error: null,
  })
})
