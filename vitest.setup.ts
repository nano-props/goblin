// Shared platform shims only. Application fixtures belong to test harnesses.
// Storage is available in both environments for browser stores loaded by Node tests.

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

Object.defineProperties(globalThis, {
  localStorage: { configurable: true, writable: true, value: makeMemoryStorage() },
  sessionStorage: { configurable: true, writable: true, value: makeMemoryStorage() },
})

// jsdom has no window focus, canvas renderer, or layout observation. These
// defaults let components mount; tests of those capabilities supply their own spies.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'focus', {
    configurable: true,
    writable: true,
    value() {},
  })
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  }
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = NoopResizeObserver
}
