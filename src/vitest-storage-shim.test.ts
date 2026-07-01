// @vitest-environment jsdom
//
// Canary for the Storage shims installed by `vitest.setup.ts`.
// The setup file installs in-memory Storage instances so browser-facing
// code can rely on `localStorage` and `sessionStorage` in tests. This
// verifies the jsdom bindings expose the Storage behavior the suite uses.

import { describe, expect, test } from 'vitest'

describe('vitest Storage shims', () => {
  test('globalThis and window expose the same storage objects', () => {
    expect(globalThis.localStorage).toBe(window.localStorage)
    expect(globalThis.sessionStorage).toBe(window.sessionStorage)
  })

  test.each([
    ['localStorage', () => window.localStorage],
    ['sessionStorage', () => window.sessionStorage],
  ] as const)('%s behaves like browser Storage', (_, getStorage) => {
    const storage = getStorage()

    storage.clear()
    expect(storage.length).toBe(0)

    storage.setItem('foo', 'bar')
    storage.setItem('count', '1')

    expect(storage.getItem('foo')).toBe('bar')
    expect(storage.getItem('missing')).toBeNull()
    expect(storage.length).toBe(2)
    expect(new Set([storage.key(0), storage.key(1)])).toEqual(new Set(['foo', 'count']))

    storage.removeItem('foo')
    expect(storage.getItem('foo')).toBeNull()
    expect(storage.length).toBe(1)

    storage.clear()
    expect(storage.getItem('count')).toBeNull()
    expect(storage.length).toBe(0)
  })
})
