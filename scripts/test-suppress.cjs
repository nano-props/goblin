// Test-time noise filter, loaded via `vitest.config.ts > test.execArgv` so it
// runs at process startup in every worker fork. Two responsibilities:
//
//   1. Silence known noise that has no diagnostic value in test output:
//        - Node v22+ warning that `--localstorage-file` was passed without a
//          valid path. Some node v25 builds print this even when nothing
//          asked for the flag; tests do not depend on it.
//        - Bun's "Sourcemap for ... points to missing source files" warning
//          for dependencies that ship no `.map` files (ssh-config, etc.).
//        - jsdom's "Not implemented:" warnings. jsdom does not implement
//          every Web API, but tests only call a handful of them and a
//          missing implementation is the test's own choice, not a real
//          signal.
//        - Hono's "serveStatic: root path '...' is not found" warning when
//          the optional `dist/web` directory is absent (typical of a fresh
//          `bun run test` without `bun run build`).
//
//   2. Provide a working `localStorage` / `sessionStorage` shim in the
//      default `node` environment so persist middlewares (e.g. Zustand in
//      `src/web/stores/repos/store.ts`) do not throw "storage.setItem is
//      not a function" when a previous test in a different env left a
//      half-stubbed global behind.

'use strict'

const { emit: originalEmit } = process

// `process.emit('warning', ...)` is the entry point Node uses for runtime
// warnings, including the ones we want to filter. Intercepting it is the
// only reliable way to suppress them; `process.on('warning', ...)` does not
// fire for the ones printed during early process startup.
const warningMessageFilters = [
  '--localstorage-file was provided without a valid path',
  'Sourcemap for',
]

process.emit = function patchedEmit(event, payload, ...rest) {
  if (event === 'warning' && payload && typeof payload.message === 'string') {
    for (const needle of warningMessageFilters) {
      if (payload.message.includes(needle)) return false
    }
  }
  return Reflect.apply(originalEmit, this, [event, payload, ...rest])
}

// jsdom and a few native modules print their notes via `console.error`
// (not via `process.emit('warning')`). Wrap `console.error` so we keep
// real test failures visible but drop the un-implemented-API noise.
const consoleErrorMessageFilters = [
  'Not implemented:',
]
const originalConsoleError = console.error.bind(console)
console.error = function patchedConsoleError(...args) {
  const first = args[0]
  if (typeof first === 'string') {
    for (const needle of consoleErrorMessageFilters) {
      if (first.includes(needle)) return
    }
  }
  return originalConsoleError(...args)
}
// Expose the real `console.error` for tests that genuinely need it (e.g.
// when a `console.error` is the *expected* call and should not be muted).
;(typeof globalThis !== 'undefined' ? globalThis : global).__originalConsoleError = originalConsoleError

// Build a small Storage shim. We deliberately do *not* gate this on
// `typeof localStorage === 'undefined'` because the noise pattern we are
// trying to fix is "a previous test installed a truthy non-Storage value
// at `globalThis.localStorage`". Replacing it on every worker boot keeps
// the persist contract clean.
function makeMemoryStorage() {
  const data = new Map()
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

const g = typeof globalThis !== 'undefined' ? globalThis : global
g.localStorage = makeMemoryStorage()
g.sessionStorage = makeMemoryStorage()

// Stub DOM bits that jsdom implements as "throw / warn" so tests that touch
// them do not produce "Not implemented" lines. Only run if the relevant
// globals exist (jsdom environment); no-op in the default `node` env.
if (typeof HTMLCanvasElement !== 'undefined') {
  // xterm's ImageAddon pulls a 2d context for image rendering. In jsdom
  // `getContext()` is unimplemented; the addon then logs
  // "Not implemented: HTMLCanvasElement's getContext() method". Returning
  // `null` here is what real browsers do when canvas is disabled, and the
  // addon falls back gracefully.
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  }
}

if (typeof window !== 'undefined') {
  // jsdom does not implement `Window.focus()` / `Window.blur()`. Tests that
  // exercise focus-restore logic call them and would otherwise print
  // "Not implemented: Window's focus() method".
  if (typeof window.focus !== 'function') {
    window.focus = function focus() {}
  }
  if (typeof window.blur !== 'function') {
    window.blur = function blur() {}
  }
}
