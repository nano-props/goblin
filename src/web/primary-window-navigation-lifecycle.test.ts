import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowNavigation,
  observePrimaryWindowHistoryNavigation,
  primaryWindowNavigationState,
  primaryWindowNavigationIsCurrent,
  registerPrimaryWindowNavigation,
  resetPrimaryWindowNavigationForTest,
} from '#/web/primary-window-navigation-lifecycle.ts'
import type { PrimaryWindowNavigationGeneration } from '#/web/primary-window-navigation-lifecycle.ts'
import { runOwnedPrimaryWindowNavigation } from '#/web/primary-window-route-navigation.ts'

beforeEach(() => resetPrimaryWindowNavigationForTest())

describe('primary window navigation lifecycle', () => {
  test('allows one history commit owner per generation and settles it when superseded', async () => {
    const generation = beginPrimaryWindowNavigation()
    const effects: string[] = []
    const failed = registerPrimaryWindowNavigation(generation, '/failed', undefined, () => {
      effects.push('failed')
      throw new Error('abandon failed')
    })
    if (!failed) throw new Error('expected owned navigation registration')

    expect(() => registerPrimaryWindowNavigation(generation, '/duplicate')).toThrow(
      'primary window navigation generation already owns a history commit',
    )

    expect(() => beginPrimaryWindowNavigation()).not.toThrow()
    expect(effects).toEqual(['failed'])
    await expect(failed.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon failed' }),
    })
  })

  test('an unknown same-href PUSH supersedes the current navigation', () => {
    const generation = beginPrimaryWindowNavigation()
    observePrimaryWindowHistoryNavigation({ href: '/same', state: {}, action: { type: 'PUSH' } })
    expect(primaryWindowNavigationIsCurrent(generation)).toBe(false)
  })

  test('treats a late PUSH from an abandoned registration as the new external presentation', () => {
    const staleGeneration = beginPrimaryWindowNavigation()
    const commitEffect = vi.fn()
    const registration = registerPrimaryWindowNavigation(staleGeneration, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation registration')
    const currentGeneration = beginPrimaryWindowNavigation()

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, staleGeneration),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowNavigationIsCurrent(currentGeneration)).toBe(false)
    expect(commitEffect).not.toHaveBeenCalled()
  })

  test('advances navigation generation even when mismatched navigation cleanup fails', async () => {
    const generation = beginPrimaryWindowNavigation()
    const registration = registerPrimaryWindowNavigation(generation, '/expected', undefined, () => {
      throw new Error('abandon effect failed')
    })
    if (!registration) throw new Error('missing navigation registration')

    observePrimaryWindowHistoryNavigation({
      href: '/actual',
      state: primaryWindowNavigationState({}, generation),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowNavigationIsCurrent(generation)).toBe(false)
    await expect(registration.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon effect failed' }),
    })
  })

  test('records a committed navigation effect failure without throwing from history observation', async () => {
    const generation = beginPrimaryWindowNavigation()
    const registration = registerPrimaryWindowNavigation(generation, '/owned', () => {
      throw new Error('commit effect failed')
    })
    if (!registration) throw new Error('missing navigation registration')

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, generation),
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
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn()

    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/owned',
        currentHref: '/start',
        commitEffect,
        abandonEffect,
        navigate: async () => await navigation.promise,
      }),
    ).toBe(true)
    await Promise.resolve()

    beginPrimaryWindowNavigation()
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
      currentHref: href,
      commitEffect: () => committed.push('first'),
      navigate: async (navigationGeneration) => {
        firstEntered.resolve()
        href = '/first'
        observePrimaryWindowHistoryNavigation({
          href,
          state: primaryWindowNavigationState({}, navigationGeneration),
          action: { type: 'PUSH' },
        })
        await releaseFirst.promise
      },
    })
    await firstEntered.promise

    runOwnedPrimaryWindowNavigation({
      targetHref: '/second',
      currentHref: href,
      commitEffect: () => {
        committed.push('second')
        secondCommitted.resolve()
      },
      navigate: async (navigationGeneration) => {
        href = '/second'
        observePrimaryWindowHistoryNavigation({
          href,
          state: primaryWindowNavigationState({}, navigationGeneration),
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
    const generation = beginPrimaryWindowNavigation()
    const commitEffect = vi.fn()
    const registration = registerPrimaryWindowNavigation(generation, '/owned', commitEffect)
    if (!registration) throw new Error('missing navigation registration')
    const state = primaryWindowNavigationState({}, generation)

    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })
    observePrimaryWindowHistoryNavigation({ href: '/owned', state, action: { type: 'REPLACE' } })

    expect(commitEffect).toHaveBeenCalledOnce()
  })

  test('a settled registration cannot release a later owner in the same generation', async () => {
    const generation = beginPrimaryWindowNavigation()
    const first = registerPrimaryWindowNavigation(generation, '/first')
    if (!first) throw new Error('missing first navigation registration')
    observePrimaryWindowHistoryNavigation({
      href: '/first',
      state: primaryWindowNavigationState({}, generation),
      action: { type: 'PUSH' },
    })
    await expect(first.settled).resolves.toEqual({ status: 'committed' })

    const secondAbandon = vi.fn()
    const second = registerPrimaryWindowNavigation(generation, '/second', undefined, secondAbandon)
    if (!second) throw new Error('missing second navigation registration')

    first.release()

    expect(secondAbandon).not.toHaveBeenCalled()
    second.release()
    expect(secondAbandon).toHaveBeenCalledOnce()
  })

  test('releasing a rejected navigation makes its later history event external', () => {
    const rejectedGeneration = beginPrimaryWindowNavigation()
    const registration = registerPrimaryWindowNavigation(rejectedGeneration, '/rejected')
    if (!registration) throw new Error('missing navigation registration')
    registration.release()
    const currentGeneration = beginPrimaryWindowNavigation()

    observePrimaryWindowHistoryNavigation({
      href: '/rejected',
      state: primaryWindowNavigationState({}, rejectedGeneration),
      action: { type: 'PUSH' },
    })

    expect(primaryWindowNavigationIsCurrent(currentGeneration)).toBe(false)
  })

  test.each(['BACK', 'FORWARD'] as const)('%s supersedes at the history callback boundary', (type) => {
    const generation = beginPrimaryWindowNavigation()
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type } })
    expect(primaryWindowNavigationIsCurrent(generation)).toBe(false)
  })

  test('GO supersedes at the history callback boundary', () => {
    const generation = beginPrimaryWindowNavigation()
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type: 'GO', index: -1 } })
    expect(primaryWindowNavigationIsCurrent(generation)).toBe(false)
  })

  test('an async blocker rejection releases ownership without committing its effect', async () => {
    const blocked = Promise.withResolvers<void>()
    const navigationStarted = Promise.withResolvers<void>()
    const navigationReleased = Promise.withResolvers<void>()
    let navigationGeneration: PrimaryWindowNavigationGeneration | null = null
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn(() => navigationReleased.resolve())
    expect(
      runOwnedPrimaryWindowNavigation({
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
    observePrimaryWindowHistoryNavigation({
      href: '/blocked',
      state: primaryWindowNavigationState({}, navigationGeneration),
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
        currentHref: '/workspace',
        commitEffect,
        navigate,
      }),
    ).toBe(true)

    expect(commitEffect).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('rejects a stale same-target presentation without committing', () => {
    const staleGeneration = beginPrimaryWindowNavigation()
    beginPrimaryWindowNavigation()
    const commitEffect = vi.fn()

    expect(
      runOwnedPrimaryWindowNavigation({
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
      beginPrimaryWindowNavigation()
    })

    expect(
      runOwnedPrimaryWindowNavigation({
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect,
        navigate: vi.fn(async () => {}),
      }),
    ).toBe(true)
    expect(commitEffect).toHaveBeenCalledOnce()
  })
})
