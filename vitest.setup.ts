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
//      implement it, but Reka UI's floating primitives observe their anchors
//      observer on every TooltipContent. A no-op shim is enough — those
//      components only use the observation to anchor the portal, which is
//      irrelevant in tests.
//
//   6. Component tests mount below the real entrypoint, which guarantees that
//      host info is ready before Vue mounts. Seed that entrypoint invariant
//      before each jsdom test; host-info tests replace it explicitly.
//
//   7. Restore jsdom's real Window before each test. Narrow transport tests
//      sometimes replace `globalThis.window` with a host facade; letting that
//      facade escape its test breaks browser lifecycle owners such as TanStack
//      Query's focus manager.

import { beforeEach } from 'vitest'
import { hostInfoStore } from '#/web/stores/host-info.ts'

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
  hostInfoStore.setState({
    snapshot: { homeDir: '/Users/test', platform: 'darwin' },
    status: 'ready',
    error: null,
  })
})
