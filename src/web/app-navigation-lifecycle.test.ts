import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import {
  beginAppNavigation,
  captureUnownedAppNavigationGeneration,
  observeAppHistoryNavigation,
  appNavigationState,
  appNavigationIsCurrent,
  registerAppNavigation,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { runOwnedAppNavigation } from '#/web/app-route-navigation.ts'

beforeEach(() => resetAppNavigationForTest())

describe('app navigation lifecycle', () => {
  test('captures the current generation only while it has no registered history commit owner', () => {
    const unownedGeneration = captureUnownedAppNavigationGeneration()
    expect(unownedGeneration).toBe(0)

    const explicitGeneration = beginAppNavigation()
    const registration = registerAppNavigation(explicitGeneration, '/pending')
    if (!registration) throw new Error('missing navigation registration')

    expect(captureUnownedAppNavigationGeneration()).toBeNull()
    expect(appNavigationIsCurrent(explicitGeneration)).toBe(true)
    registration.release()
    expect(captureUnownedAppNavigationGeneration()).toBe(explicitGeneration)
  })

  test('allows one history commit owner per generation and settles it when superseded', async () => {
    const generation = beginAppNavigation()
    const effects: string[] = []
    const failed = registerAppNavigation(generation, '/failed', undefined, () => {
      effects.push('failed')
      throw new Error('abandon failed')
    })
    if (!failed) throw new Error('expected owned navigation registration')

    expect(() => registerAppNavigation(generation, '/duplicate')).toThrow(
      'app navigation generation already owns a history commit',
    )

    expect(() => beginAppNavigation()).not.toThrow()
    expect(effects).toEqual(['failed'])
    await expect(failed.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon failed' }),
    })
  })

  test('an unknown same-href PUSH supersedes the current navigation', () => {
    const generation = beginAppNavigation()
    observeAppHistoryNavigation({ href: '/same', state: {}, action: { type: 'PUSH' } })
    expect(appNavigationIsCurrent(generation)).toBe(false)
  })

  test('treats a late PUSH from an abandoned registration as the new external presentation', () => {
    const staleGeneration = beginAppNavigation()
    const commitEffect = vi.fn()
    const registration = registerAppNavigation(staleGeneration, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation registration')
    const currentGeneration = beginAppNavigation()

    observeAppHistoryNavigation({
      href: '/owned',
      state: appNavigationState({}, staleGeneration),
      action: { type: 'PUSH' },
    })

    expect(appNavigationIsCurrent(currentGeneration)).toBe(false)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('advances navigation generation even when mismatched navigation cleanup fails', async () => {
    const generation = beginAppNavigation()
    const registration = registerAppNavigation(generation, '/expected', undefined, () => {
      throw new Error('abandon effect failed')
    })
    if (!registration) throw new Error('missing navigation registration')

    observeAppHistoryNavigation({
      href: '/actual',
      state: appNavigationState({}, generation),
      action: { type: 'PUSH' },
    })

    expect(appNavigationIsCurrent(generation)).toBe(false)
    await expect(registration.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon effect failed' }),
    })
  })

  test('records a committed navigation effect failure without throwing from history observation', async () => {
    const generation = beginAppNavigation()
    const registration = registerAppNavigation(generation, '/owned', () => {
      throw new Error('commit effect failed')
    })
    if (!registration) throw new Error('missing navigation registration')

    observeAppHistoryNavigation({
      href: '/owned',
      state: appNavigationState({}, generation),
      action: { type: 'PUSH' },
    })
    await expect(registration.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'committed',
      error: expect.objectContaining({ message: 'commit effect failed' }),
    })
  })

  test('a newer presentation abandons an owned navigation exactly once', async () => {
    const navigation = Promise.withResolvers<void>()
    const navigationStarted = Promise.withResolvers<void>()
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn()

    expect(
      runOwnedAppNavigation({
        targetHref: '/owned',
        currentHref: '/start',
        commitEffect,
        abandonEffect,
        navigate: async () => {
          navigationStarted.resolve()
          await navigation.promise
        },
      }),
    ).toBe(true)
    await navigationStarted.promise

    beginAppNavigation()
    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()

    navigation.resolve()
    await waitForNextMacrotask()
    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('does not let an unsettled prior router promise block the current navigation', async () => {
    const firstEntered = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const secondCommitted = Promise.withResolvers<void>()
    const committed: string[] = []
    let href = '/start'

    runOwnedAppNavigation({
      targetHref: '/first',
      currentHref: href,
      commitEffect: () => committed.push('first'),
      navigate: async (navigationGeneration) => {
        firstEntered.resolve()
        href = '/first'
        observeAppHistoryNavigation({
          href,
          state: appNavigationState({}, navigationGeneration),
          action: { type: 'PUSH' },
        })
        await releaseFirst.promise
      },
    })
    await firstEntered.promise

    runOwnedAppNavigation({
      targetHref: '/second',
      currentHref: href,
      commitEffect: () => {
        committed.push('second')
        secondCommitted.resolve()
      },
      navigate: async (navigationGeneration) => {
        href = '/second'
        observeAppHistoryNavigation({
          href,
          state: appNavigationState({}, navigationGeneration),
          action: { type: 'PUSH' },
        })
      },
    })

    await secondCommitted.promise
    expect(href).toBe('/second')
    expect(committed).toEqual(['first', 'second'])

    releaseFirst.resolve()
    await waitForNextMacrotask()

    expect(href).toBe('/second')
    expect(committed).toEqual(['first', 'second'])
  })

  test('a current owned observation commits its effect exactly once', () => {
    const generation = beginAppNavigation()
    const commitEffect = vi.fn()
    const registration = registerAppNavigation(generation, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation registration')
    const state = appNavigationState({}, generation)

    observeAppHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })
    observeAppHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })

    expect(commitEffect).toHaveBeenCalledOnce()
  })

  test('a settled registration cannot release a later owner in the same generation', async () => {
    const generation = beginAppNavigation()
    const first = registerAppNavigation(generation, '/first')
    if (!first) throw new Error('missing first navigation registration')
    observeAppHistoryNavigation({
      href: '/first',
      state: appNavigationState({}, generation),
      action: { type: 'PUSH' },
    })
    await expect(first.settled).resolves.toEqual({ status: 'committed' })

    const secondAbandon = vi.fn()
    const second = registerAppNavigation(generation, '/second', undefined, secondAbandon)
    if (!second) throw new Error('missing second navigation registration')

    first.release()

    expect(secondAbandon).not.toHaveBeenCalled()
    second.release()
    expect(secondAbandon).toHaveBeenCalledOnce()
  })

  test('releasing a rejected navigation makes its later history event external', () => {
    const rejectedGeneration = beginAppNavigation()
    const registration = registerAppNavigation(rejectedGeneration, '/rejected')
    if (!registration) throw new Error('missing navigation registration')
    registration.release()
    const currentGeneration = beginAppNavigation()

    observeAppHistoryNavigation({
      href: '/rejected',
      state: appNavigationState({}, rejectedGeneration),
      action: { type: 'PUSH' },
    })

    expect(appNavigationIsCurrent(currentGeneration)).toBe(false)
  })

  test.each(['BACK', 'FORWARD'] as const)('%s supersedes at the history callback boundary', (type) => {
    const generation = beginAppNavigation()
    observeAppHistoryNavigation({ href: '/history', state: {}, action: { type } })
    expect(appNavigationIsCurrent(generation)).toBe(false)
  })

  test('GO supersedes at the history callback boundary', () => {
    const generation = beginAppNavigation()
    observeAppHistoryNavigation({ href: '/history', state: {}, action: { type: 'GO', index: -1 } })
    expect(appNavigationIsCurrent(generation)).toBe(false)
  })

  test('an async blocker rejection releases ownership without committing its effect', async () => {
    const blocked = Promise.withResolvers<void>()
    const navigationStarted = Promise.withResolvers<void>()
    const navigationReleased = Promise.withResolvers<void>()
    let navigationGeneration: AppNavigationGeneration | null = null
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn(() => navigationReleased.resolve())
    expect(
      runOwnedAppNavigation({
        targetHref: '/blocked',
        currentHref: '/start',
        commitEffect,
        abandonEffect,
        navigate: async (ownedNavigationGeneration) => {
          navigationGeneration = ownedNavigationGeneration
          navigationStarted.resolve()
          return await blocked.promise
        },
      }),
    ).toBe(true)

    await navigationStarted.promise
    blocked.reject(new Error('blocked'))
    await blocked.promise.catch(() => {})
    await navigationReleased.promise
    if (navigationGeneration === null) throw new Error('missing navigation generation')
    observeAppHistoryNavigation({
      href: '/blocked',
      state: appNavigationState({}, navigationGeneration),
      action: { type: 'PUSH' },
    })

    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('commits a same-target presentation without waiting for a no-op router event', () => {
    const commitEffect = vi.fn()
    const navigate = vi.fn(async () => {})

    expect(
      runOwnedAppNavigation({
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect,
        navigate,
      }),
    ).toBe(true)

    expect(commitEffect).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('rejects a stale same-target presentation without committing', () => {
    const staleGeneration = beginAppNavigation()
    beginAppNavigation()
    const commitEffect = vi.fn()

    expect(
      runOwnedAppNavigation({
        generation: staleGeneration,
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect,
        navigate: vi.fn(async () => {}),
      }),
    ).toBe(false)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('accepts a same-target commit whose effect starts the next presentation', () => {
    const commitEffect = vi.fn(() => {
      beginAppNavigation()
    })

    expect(
      runOwnedAppNavigation({
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect,
        navigate: vi.fn(async () => {}),
      }),
    ).toBe(true)
    expect(commitEffect).toHaveBeenCalledOnce()
  })
})
