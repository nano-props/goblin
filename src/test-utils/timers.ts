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
import { flushMicrotasks } from './microtasks.ts'

const FAKE_TIMER_OPTIONS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: [
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'Date',
    'performance',
  ],
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Enable fake timers with the project's standard `toFake` list and
 * The module-level `afterEach` restores real timers after every test.
 *
 * Returns the `vi` namespace so callers can chain timer operations.
 */
export function useFakeTimers(): typeof vi {
  vi.useFakeTimers(FAKE_TIMER_OPTIONS)
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
  await flushMicrotasks()
}
