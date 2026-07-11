import { describe, expect, test, vi } from 'vitest'
import { DelayedPresenceExpiry } from '#/server/realtime/delayed-presence-expiry.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'

describe('DelayedPresenceExpiry', () => {
  test('expires confirmed absence after the grace period', async () => {
    useFakeTimers()
    const expired = vi.fn()
    const scheduler = new DelayedPresenceExpiry<string>(1_000)
    scheduler.schedule('client', () => false, expired)

    await advanceTimersAndFlush(1_000)

    expect(expired).toHaveBeenCalledOnce()
    expect(scheduler.has('client')).toBe(false)
  })

  test('cancels expiry on renewed presence and rechecks presence at the deadline', async () => {
    useFakeTimers()
    const expired = vi.fn()
    const scheduler = new DelayedPresenceExpiry<string>(1_000)
    scheduler.schedule('cancelled', () => false, expired)
    scheduler.cancel('cancelled')
    scheduler.schedule('present', () => true, expired)

    await advanceTimersAndFlush(1_000)

    expect(expired).not.toHaveBeenCalled()
  })
})
