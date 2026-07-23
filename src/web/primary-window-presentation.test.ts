import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowPresentation,
  observePrimaryWindowHistoryNavigation,
  admitPrimaryWindowNavigationWhenUncontested,
  primaryWindowNavigationState,
  primaryWindowPresentationIsCurrent,
  registerPrimaryWindowPresentationAbandon,
  registerPrimaryWindowNavigation,
  releasePrimaryWindowNavigation,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import { runOwnedPrimaryWindowNavigation } from '#/web/primary-window-route-navigation.ts'

beforeEach(() => resetPrimaryWindowPresentationForTest())

describe('primary window presentation history ownership', () => {
  test('admits once after foreign navigation settles without observing navigation started by the callback', () => {
    const foreignToken = beginPrimaryWindowPresentation()
    const foreignNavigation = registerPrimaryWindowNavigation(foreignToken, '/foreign')
    if (!foreignNavigation) throw new Error('missing foreign navigation fixture')
    const admitted = vi.fn(() => {
      const ownToken = beginPrimaryWindowPresentation()
      const ownNavigation = registerPrimaryWindowNavigation(ownToken, '/owned')
      if (!ownNavigation) throw new Error('missing owned navigation fixture')
      releasePrimaryWindowNavigation(ownNavigation.navigationId)
    })

    const cancel = admitPrimaryWindowNavigationWhenUncontested(admitted)
    expect(admitted).not.toHaveBeenCalled()
    releasePrimaryWindowNavigation(foreignNavigation.navigationId)

    expect(admitted).toHaveBeenCalledOnce()
    cancel()
  })

  test('does not admit stale reconciliation while a committed navigation is settling', async () => {
    const token = beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn()
    const navigation = registerPrimaryWindowNavigation(token, '/target', commitEffect, abandonEffect)
    if (!navigation) throw new Error('missing navigation fixture')
    const admitted = vi.fn(() => beginPrimaryWindowPresentation())
    admitPrimaryWindowNavigationWhenUncontested(admitted)

    expect(
      observePrimaryWindowHistoryNavigation({
        href: '/target',
        state: primaryWindowNavigationState({}, navigation.navigationId),
        action: { type: 'PUSH' },
      }),
    ).toEqual({ ok: true })

    await expect(navigation.settled).resolves.toEqual({ status: 'committed' })
    expect(commitEffect).toHaveBeenCalledOnce()
    expect(abandonEffect).not.toHaveBeenCalled()
    expect(admitted).not.toHaveBeenCalled()
  })

  test('settles every ownership before propagating an abandonment effect failure', () => {
    const token = beginPrimaryWindowPresentation()
    const effects: string[] = []
    registerPrimaryWindowPresentationAbandon(token, () => {
      effects.push('failed')
      throw new Error('abandon failed')
    })
    registerPrimaryWindowPresentationAbandon(token, () => effects.push('settled'))

    expect(() => beginPrimaryWindowPresentation()).toThrow('abandon failed')
    expect(effects).toEqual(['failed', 'settled'])
  })

  test('an unknown same-href PUSH supersedes the current presentation', () => {
    const token = beginPrimaryWindowPresentation()
    observePrimaryWindowHistoryNavigation({ href: '/same', state: {}, action: { type: 'PUSH' } })
    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
  })

  test('treats a late PUSH from an abandoned registration as the new external presentation', () => {
    const staleToken = beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()
    const registration = registerPrimaryWindowNavigation(staleToken, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation id')
    const currentToken = beginPrimaryWindowPresentation()

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, registration.navigationId),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowPresentationIsCurrent(currentToken)).toBe(false)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('advances URL presentation authority even when mismatched navigation cleanup fails', async () => {
    const token = beginPrimaryWindowPresentation()
    const registration = registerPrimaryWindowNavigation(token, '/expected', undefined, () => {
      throw new Error('abandon effect failed')
    })
    if (!registration) throw new Error('missing navigation id')

    const observation = observePrimaryWindowHistoryNavigation({
      href: '/actual',
      state: primaryWindowNavigationState({}, registration.navigationId),
      action: { type: 'PUSH' },
    })

    expect(observation).toEqual({ ok: true })
    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
    await expect(registration.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon effect failed' }),
    })
  })

  test('records a committed navigation effect failure without throwing from history observation', async () => {
    const token = beginPrimaryWindowPresentation()
    const registration = registerPrimaryWindowNavigation(token, '/owned', () => {
      throw new Error('commit effect failed')
    })
    if (!registration) throw new Error('missing navigation id')

    expect(
      observePrimaryWindowHistoryNavigation({
        href: '/owned',
        state: primaryWindowNavigationState({}, registration.navigationId),
        action: { type: 'PUSH' },
      }),
    ).toEqual({ ok: true })
    await expect(registration.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'committed',
      error: expect.objectContaining({ message: 'commit effect failed' }),
    })
  })

  test('a newer presentation abandons an owned navigation exactly once', async () => {
    const navigation = Promise.withResolvers<void>()
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn()

    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/owned',
        commitEffect,
        abandonEffect,
        navigate: async () => await navigation.promise,
      }),
    ).toBe(true)
    await Promise.resolve()

    beginPrimaryWindowPresentation()
    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()

    navigation.resolve()
    await navigation.promise
    await Promise.resolve()
    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('does not let an unsettled prior router promise block the current navigation', async () => {
    const firstEntered = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const secondCommitted = Promise.withResolvers<void>()
    const committed: string[] = []
    let href = '/start'

    runOwnedPrimaryWindowNavigation({
      targetHref: '/first',
      commitEffect: () => committed.push('first'),
      navigate: async (navigationId) => {
        firstEntered.resolve()
        href = '/first'
        observePrimaryWindowHistoryNavigation({
          href,
          state: primaryWindowNavigationState({}, navigationId),
          action: { type: 'PUSH' },
        })
        await releaseFirst.promise
      },
    })
    await firstEntered.promise

    runOwnedPrimaryWindowNavigation({
      targetHref: '/second',
      commitEffect: () => {
        committed.push('second')
        secondCommitted.resolve()
      },
      navigate: async (navigationId) => {
        href = '/second'
        observePrimaryWindowHistoryNavigation({
          href,
          state: primaryWindowNavigationState({}, navigationId),
          action: { type: 'PUSH' },
        })
      },
    })

    await secondCommitted.promise
    expect(href).toBe('/second')
    expect(committed).toEqual(['first', 'second'])

    releaseFirst.resolve()
    await releaseFirst.promise
    await Promise.resolve()

    expect(href).toBe('/second')
    expect(committed).toEqual(['first', 'second'])
  })

  test('a current owned observation commits its effect exactly once', () => {
    const token = beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()
    const registration = registerPrimaryWindowNavigation(token, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation id')
    const state = primaryWindowNavigationState({}, registration.navigationId)

    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })
    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })

    expect(commitEffect).toHaveBeenCalledOnce()
  })

  test('releasing a rejected navigation makes its later id external', () => {
    const rejectedToken = beginPrimaryWindowPresentation()
    const registration = registerPrimaryWindowNavigation(rejectedToken, '/rejected')
    if (!registration) throw new Error('missing navigation id')
    releasePrimaryWindowNavigation(registration.navigationId)
    const currentToken = beginPrimaryWindowPresentation()

    observePrimaryWindowHistoryNavigation({
      href: '/rejected',
      state: primaryWindowNavigationState({}, registration.navigationId),
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
    const navigationStarted = Promise.withResolvers<void>()
    const navigationReleased = Promise.withResolvers<void>()
    let navigationId = ''
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn(() => navigationReleased.resolve())
    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/blocked',
        commitEffect,
        abandonEffect,
        navigate: async (ownedNavigationId) => {
          navigationId = ownedNavigationId
          navigationStarted.resolve()
          return await blocked.promise
        },
      }),
    ).toBe(true)

    await navigationStarted.promise
    blocked.reject(new Error('blocked'))
    await blocked.promise.catch(() => {})
    await navigationReleased.promise
    observePrimaryWindowHistoryNavigation({
      href: '/blocked',
      state: primaryWindowNavigationState({}, navigationId),
      action: { type: 'PUSH' },
    })

    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('commits a same-target presentation without waiting for a no-op router event', () => {
    const commitEffect = vi.fn()
    const navigate = vi.fn(async () => {})

    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/workspace',
        currentHref: () => '/workspace',
        commitEffect,
        navigate,
      }),
    ).toBe(true)

    expect(commitEffect).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('rejects a stale same-target presentation without committing', () => {
    const staleToken = beginPrimaryWindowPresentation()
    beginPrimaryWindowPresentation()
    const commitEffect = vi.fn()

    expect(
      runOwnedPrimaryWindowNavigation({
        token: staleToken,
        targetHref: '/workspace',
        currentHref: () => '/workspace',
        commitEffect,
        navigate: vi.fn(async () => {}),
      }),
    ).toBe(false)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('accepts a same-target commit whose effect starts the next presentation', () => {
    const commitEffect = vi.fn(() => {
      beginPrimaryWindowPresentation()
    })

    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/workspace',
        currentHref: () => '/workspace',
        commitEffect,
        navigate: vi.fn(async () => {}),
      }),
    ).toBe(true)
    expect(commitEffect).toHaveBeenCalledOnce()
  })
})
