// @vitest-environment jsdom

import { focusManager } from '@tanstack/query-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import '#/web/app-query-client.ts'

describe('app query focus events', () => {
  afterEach(() => {
    focusManager.setFocused(undefined)
    vi.restoreAllMocks()
  })

  test('coalesces overlapping browser activation events into focus state transitions', () => {
    let focused = true
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    focusManager.setFocused(undefined)
    const states: boolean[] = []
    const unsubscribe = focusManager.subscribe((state) => states.push(state))
    try {
      focused = false
      window.dispatchEvent(new Event('blur'))
      focused = true
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      visibility = 'hidden'
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      document.dispatchEvent(new Event('visibilitychange'))
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))

      expect(states).toEqual([false, true, true, false, true])
    } finally {
      unsubscribe()
    }
  })
})
