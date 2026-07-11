import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowPresentation,
  observePrimaryWindowHistoryNavigation,
  primaryWindowNavigationState,
  primaryWindowPresentationIsCurrent,
  registerPrimaryWindowNavigation,
  releasePrimaryWindowNavigation,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import { runOwnedPrimaryWindowNavigation } from '#/web/primary-window-route-navigation.ts'

beforeEach(() => resetPrimaryWindowPresentationForTest())

describe('primary window presentation history ownership', () => {
  test('an unknown same-href PUSH supersedes the current presentation', () => {
    const token = beginPrimaryWindowPresentation()
    observePrimaryWindowHistoryNavigation({ href: '/same', state: {}, action: { type: 'PUSH' } })
    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
  })

  test('a stale owned PUSH is consumed without superseding the newer presentation', () => {
    const staleToken = beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()
    const navigationId = registerPrimaryWindowNavigation(staleToken, '/owned', commitEffect)
    if (!navigationId) throw new Error('missing navigation id')
    const currentToken = beginPrimaryWindowPresentation()

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, navigationId),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowPresentationIsCurrent(currentToken)).toBe(true)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('a current owned observation commits its effect exactly once', () => {
    const token = beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()
    const navigationId = registerPrimaryWindowNavigation(token, '/owned', commitEffect)
    if (!navigationId) throw new Error('missing navigation id')
    const state = primaryWindowNavigationState({}, navigationId)

    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })
    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })

    expect(commitEffect).toHaveBeenCalledOnce()
  })

  test('releasing a rejected navigation makes its later id external', () => {
    const rejectedToken = beginPrimaryWindowPresentation()
    const navigationId = registerPrimaryWindowNavigation(rejectedToken, '/rejected')
    if (!navigationId) throw new Error('missing navigation id')
    releasePrimaryWindowNavigation(navigationId)
    const currentToken = beginPrimaryWindowPresentation()

    observePrimaryWindowHistoryNavigation({
      href: '/rejected',
      state: primaryWindowNavigationState({}, navigationId),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowPresentationIsCurrent(currentToken)).toBe(false)
  })

  test.each(['BACK', 'FORWARD'] as const)('%s supersedes at the history callback boundary', (type) => {
    const token = beginPrimaryWindowPresentation()
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type } })
    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
  })

  test('GO supersedes at the history callback boundary', () => {
    const token = beginPrimaryWindowPresentation()
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type: 'GO', index: -1 } })
    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
  })

  test('an async blocker rejection releases ownership without committing its effect', async () => {
    const blocked = Promise.withResolvers<void>()
    let navigationId = ''
    const commitEffect = vi.fn()
    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/blocked',
        commitEffect,
        navigate: async (ownedNavigationId) => {
          navigationId = ownedNavigationId
          return await blocked.promise
        },
      }),
    ).toBe(true)

    blocked.reject(new Error('blocked'))
    await blocked.promise.catch(() => {})
    await Promise.resolve()
    observePrimaryWindowHistoryNavigation({
      href: '/blocked',
      state: primaryWindowNavigationState({}, navigationId),
      action: { type: 'PUSH' },
    })

    expect(commitEffect).not.toHaveBeenCalled()
  })
})
