// @vitest-environment jsdom
//
// Smoke test for the `localStorage` shim installed by `vitest.setup.ts`.
// The setup file installs an in-memory `Storage` for both
// `localStorage` and `sessionStorage` so Zustand's persist middleware
// always finds a valid store. This test verifies the shim behaves like
// a browser Storage: set → get round-trips, clear empties it.

import { expect, test } from 'vitest'

test('localStorage with polyfill', () => {
  window.localStorage.setItem('foo', 'bar')
  expect(window.localStorage.getItem('foo')).toBe('bar')
  window.localStorage.clear()
  expect(window.localStorage.getItem('foo')).toBeNull()
})
