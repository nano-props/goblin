// Shared jsdom render helpers. Tests import `renderInJsdom` instead of
// hand-rolling `createRoot` + `container` + `act` boilerplate.
//
// Why a helper rather than `@testing-library/react` directly:
//   - RTL's `act()` toggles `IS_REACT_ACT_ENVIRONMENT` only for the
//     duration of the wrapped callback. Tests that drive fake timers
//     after `render(...)` returns — which most jsdom tests in this
//     repo do — would otherwise see React's act warning when their
//     timer callbacks trigger updates. We set the flag once per test
//     so the rest of the test body can use `vi.runAllTimersAsync`
//     and `vi.advanceTimersByTimeAsync` without the warning.
//   - `cleanup` is registered with `afterEach` so callers don't repeat
//     the import.
//   - `flushAnimationFrames` and `flushMicrotasks` exist because
//     several tests need to drive microtasks or rAF deterministically;
//     without these, tests reach for ad-hoc
//     `for (let i = 0; i < 5; i++) await Promise.resolve()` loops,
//     which the testing spec forbids.

import { afterEach } from 'vitest'
import { cleanup, render, type RenderOptions, type RenderResult } from '@testing-library/react'

/**
 * Enable React's act environment for the rest of the worker. Setting
 * `IS_REACT_ACT_ENVIRONMENT = true` on `globalThis` is what RTL itself
 * does internally for `act()`; we just keep it on permanently so
 * timer-driven updates later in the test stay quiet.
 */
function setReactActEnvironment(): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
}

let afterEachRegistered = false
function ensureAfterEachRegistered(): void {
  if (afterEachRegistered) return
  afterEach(() => {
    cleanup()
  })
  afterEachRegistered = true
}

/**
 * Render a React element under jsdom with React's act environment
 * enabled for the duration of the test. Replaces the 20-line
 * hand-rolled `createRoot` + `container` + `act` boilerplate used by
 * ~60 test files before this helper existed.
 *
 * Returns the standard RTL result plus a `flushAnimationFrames`
 * helper for tests that drive `requestAnimationFrame` directly.
 */
export function renderInJsdom(
  element: React.ReactNode,
  options?: RenderOptions,
): RenderResult & { flushAnimationFrames: (frames?: number) => Promise<void> } {
  setReactActEnvironment()
  ensureAfterEachRegistered()
  const result = render(element, options)
  return {
    ...result,
    async flushAnimationFrames(frames = 1): Promise<void> {
      for (let i = 0; i < frames; i += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    },
  }
}

/**
 * Drain `ticks` microtask rounds. Prefer this over an inline
 * `for (let i = 0; i < 5; i++) await Promise.resolve()` so the count is
 * visible and reviewable.
 */
export async function flushMicrotasks(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve()
  }
}

