import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginPrimaryWindowNavigationIntent,
  observePrimaryWindowHistoryNavigation,
  primaryWindowNavigationState,
  resetPrimaryWindowNavigationForTest,
  tryBeginPassivePrimaryWindowNavigationIntent,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { runOwnedPrimaryWindowNavigation } from '#/web/primary-window-route-navigation.ts'

beforeEach(() => resetPrimaryWindowNavigationForTest())

describe('primary window navigation intent lifecycle', () => {
  test('a newer user intent supersedes the current user intent', async () => {
    const first = beginPrimaryWindowNavigationIntent('user')
    const second = beginPrimaryWindowNavigationIntent('user')

    await expect(first.settled).resolves.toEqual({ status: 'superseded' })
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  test('a stale release cannot settle the current intent', async () => {
    const first = beginPrimaryWindowNavigationIntent('user')
    const second = beginPrimaryWindowNavigationIntent('user')

    first.release()
    expect(second.isCurrent()).toBe(true)
    second.commit()
    await expect(second.settled).resolves.toEqual({ status: 'committed' })
  })

  test('lexical disposal abandons an unsettled intent', async () => {
    let settlement: Promise<unknown>
    {
      using intent = beginPrimaryWindowNavigationIntent('user')
      settlement = intent.settled
    }

    await expect(settlement).resolves.toEqual({ status: 'abandoned' })
  })

  test('passive admission waits for the current owner without superseding it', async () => {
    const user = beginPrimaryWindowNavigationIntent('user')
    const blocked = tryBeginPassivePrimaryWindowNavigationIntent()
    expect(blocked).toMatchObject({ kind: 'occupied', ownerKind: 'user' })
    expect(user.isCurrent()).toBe(true)

    user.release()
    if (blocked.kind !== 'occupied') throw new Error('expected occupied admission')
    await expect(blocked.settled).resolves.toEqual({ status: 'abandoned' })

    const admitted = tryBeginPassivePrimaryWindowNavigationIntent()
    expect(admitted.kind).toBe('admitted')
    if (admitted.kind === 'admitted') admitted.intent.release()
  })

  test('a user intent supersedes a current passive intent', async () => {
    const admission = tryBeginPassivePrimaryWindowNavigationIntent()
    if (admission.kind !== 'admitted') throw new Error('expected passive admission')

    const user = beginPrimaryWindowNavigationIntent('user')
    await expect(admission.intent.settled).resolves.toEqual({ status: 'superseded' })
    expect(user.isCurrent()).toBe(true)
  })

  test('registration is part of the same intent and commits at history observation', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    const commitEffect = vi.fn()
    const registration = intent.register('/owned', commitEffect)
    if (!registration) throw new Error('expected navigation registration')

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, intent.generation),
      action: { type: 'PUSH' },
    })

    await expect(intent.settled).resolves.toEqual({ status: 'committed' })
    expect(registration.settled).toBe(intent.settled)
    expect(commitEffect).toHaveBeenCalledOnce()
  })

  test('an intent can register at most one history commit', () => {
    using intent = beginPrimaryWindowNavigationIntent('user')
    expect(intent.register('/first')).not.toBeNull()
    expect(intent.register('/second')).toBeNull()
  })

  test('a mismatched history event supersedes the registration', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    const abandonEffect = vi.fn()
    intent.register('/expected', undefined, abandonEffect)

    observePrimaryWindowHistoryNavigation({
      href: '/actual',
      state: primaryWindowNavigationState({}, intent.generation),
      action: { type: 'PUSH' },
    })

    await expect(intent.settled).resolves.toEqual({ status: 'superseded' })
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('records commit-effect failure as a failed committed intent', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    intent.register('/owned', () => {
      throw new Error('commit effect failed')
    })

    observePrimaryWindowHistoryNavigation({
      href: '/owned',
      state: primaryWindowNavigationState({}, intent.generation),
      action: { type: 'REPLACE' },
    })

    await expect(intent.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'committed',
      error: expect.objectContaining({ message: 'commit effect failed' }),
    })
  })

  test('records abandon-effect failure without retaining ownership', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    intent.register('/owned', undefined, () => {
      throw new Error('abandon effect failed')
    })
    intent.release()

    await expect(intent.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'abandoned',
      error: expect.objectContaining({ message: 'abandon effect failed' }),
    })
    const next = tryBeginPassivePrimaryWindowNavigationIntent()
    expect(next.kind).toBe('admitted')
    if (next.kind === 'admitted') next.intent.release()
  })

  test.each(['BACK', 'FORWARD'] as const)('%s supersedes the current intent', async (type) => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type } })
    await expect(intent.settled).resolves.toEqual({ status: 'superseded' })
  })

  test('GO supersedes the current intent', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    observePrimaryWindowHistoryNavigation({ href: '/history', state: {}, action: { type: 'GO', index: -1 } })
    await expect(intent.settled).resolves.toEqual({ status: 'superseded' })
  })

  test('an async navigation rejection abandons ownership without committing', async () => {
    const blocked = Promise.withResolvers<void>()
    const abandonEffect = vi.fn()
    const intent = beginPrimaryWindowNavigationIntent('user')
    expect(
      runOwnedPrimaryWindowNavigation({
        intent,
        targetHref: '/blocked',
        currentHref: '/start',
        commitEffect: vi.fn(),
        abandonEffect,
        navigate: async () => await blocked.promise,
      }),
    ).toBe(true)

    blocked.reject(new Error('blocked'))
    await expect(intent.settled).resolves.toMatchObject({ status: 'failed', intendedStatus: 'committed' })
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('same-target navigation commits synchronously without invoking the router', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    const commitEffect = vi.fn()
    const navigate = vi.fn(async () => {})

    expect(
      runOwnedPrimaryWindowNavigation({
        intent,
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect,
        navigate,
      }),
    ).toBe(true)
    await expect(intent.settled).resolves.toEqual({ status: 'committed' })
    expect(commitEffect).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('same-target navigation reports a synchronous commit-effect failure', async () => {
    const intent = beginPrimaryWindowNavigationIntent('user')
    const navigate = vi.fn(async () => {})

    expect(
      runOwnedPrimaryWindowNavigation({
        intent,
        targetHref: '/workspace',
        currentHref: '/workspace',
        commitEffect: () => {
          throw new Error('commit effect failed')
        },
        navigate,
      }),
    ).toBe(false)
    await expect(intent.settled).resolves.toMatchObject({
      status: 'failed',
      intendedStatus: 'committed',
      error: expect.objectContaining({ message: 'commit effect failed' }),
    })
    expect(navigate).not.toHaveBeenCalled()
  })
})
