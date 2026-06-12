// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest'
beforeEach(() => {
  const store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length
      },
    },
    configurable: true,
  })
})
test('localStorage with polyfill', () => {
  window.localStorage.setItem('foo', 'bar')
  expect(window.localStorage.getItem('foo')).toBe('bar')
  window.localStorage.clear()
  expect(window.localStorage.getItem('foo')).toBeNull()
})
