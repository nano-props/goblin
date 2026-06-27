// Shared fake-timer policy.
//
// Why a helper rather than calling `vi.useFakeTimers` directly:
//   - The `toFake` list is the same across nearly every fake-timer test
//     in the repo. Centralizing it removes 25 copies of the same options
//     object and prevents drift (some files forget to fake
//     `requestAnimationFrame`, others forget `Date`).
//   - `afterEach(() => vi.useRealTimers())` is registered automatically,
//     so a stale fake clock cannot leak into the next test.
//   - `advanceTimersAndFlush` pairs timer advancement with microtask
//     draining, which is what callers actually need when stepping through
//     debounce / reconnect code paths.

import { afterEach, vi } from 'vitest'

const FAKE_TIMER_OPTIONS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date', 'performance'],
}

let registered = false

/**
 * Enable fake timers with the project's standard `toFake` list and
 * register an `afterEach` to restore real timers. Idempotent: a second
 * call inside the same worker is a no-op for the afterEach registration.
 *
 * Returns the `vi` namespace so callers can chain timer operations.
 */
export function useFakeTimers(): typeof vi {
  vi.useFakeTimers(FAKE_TIMER_OPTIONS)
  if (!registered) {
    afterEach(() => {
      vi.useRealTimers()
    })
    registered = true
  }
  return vi
}

/**
 * Advance fake timers by `ms` and drain pending microtasks. Use this
 * instead of bare `vi.advanceTimersByTimeAsync(ms)` when the test step
 * also needs promises scheduled by timer callbacks to settle before the
 * next assertion.
 */
export async function advanceTimersAndFlush(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}
