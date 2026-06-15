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
//   3. Stub `HTMLCanvasElement.prototype.getContext` to return null in jsdom.
//      xterm's ImageAddon pulls a 2d context for image rendering, and jsdom
//      logs "Not implemented: HTMLCanvasElement's getContext() method"
//      otherwise. Returning null is what real browsers do when canvas is
//      disabled, and the addon falls back gracefully. Per-test `vi.spyOn`
//      calls still take precedence (they run after this stub is installed).

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

// Only relevant in the jsdom environment; no-op when undefined.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  }
}
