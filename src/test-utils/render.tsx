// Shared jsdom render helpers. Tests import `renderInJsdom` instead of
// hand-rolling `createRoot` + `container` + `act` boilerplate.
//
// Why a helper rather than `@testing-library/react` directly:
//   - RTL's `render` is synchronous and does not wrap the call in an
//     `act()` boundary of its own; React 18+ trusts the test author to
//     pass an `await act(async () => render(...))` wrapper when the test
//     drives async updates, timers, or intermediate state. Most tests
//     in this repo call `renderInJsdom(...)` without an explicit
//     `act()` wrapper — they only need to verify final DOM state, not
//     observe every intermediate commit. `renderInJsdom` mirrors
//     RTL's behavior and does not impose an `act` boundary itself.
//   - `cleanup` is registered with `afterEach` so callers don't repeat
//     the import.
//   - `flushAnimationFrames` and `flushMicrotasks` exist because
//     several tests need to drive microtasks or rAF deterministically;
//     without these, tests reach for ad-hoc
//     `for (let i = 0; i < 5; i++) await Promise.resolve()` loops,
//     which the testing spec forbids.
//
// Why `renderInJsdom` does NOT set `globalThis.IS_REACT_ACT_ENVIRONMENT =
// true` permanently (an earlier revision of this file did):
//
//   React 19's `warnIfUpdatesNotWrappedWithActDEV` fires when
//     `IS_REACT_ACT_ENVIRONMENT` is true AND no `act` is currently on
//     the call stack. Permanently flipping the global to true, then
//     letting `render(...)` return, leaves the worker in the "act
//     environment is on but no act is running" state, which produces
//     the "An update to <Component> inside a test was not wrapped in
//     act(...)" warnings on every fire-and-forget Promise chain that
//     schedules a setState after the initial mount.
//
//   RTL itself keeps `IS_REACT_ACT_ENVIRONMENT` set only for the
//     duration of its own `act()` wrapper (see
//     `node_modules/@testing-library/react/dist/act-compat.js:39-77`).
//     Tests that need an `act` boundary — typically those that drive
//     fake timers, await async updates, or assert on intermediate
//     state — should import `act` from `@testing-library/react` and
//     wrap their calls in `await act(async () => …)` themselves.
//     Importing `act` from `react` directly does not set the test
//     environment flag and can emit "The current testing environment is
//     not configured to support act(...)". `renderInJsdom` does not
//     assume that need on the caller's behalf.

import { afterEach } from 'vitest'
import { cleanup, render, type RenderOptions, type RenderResult } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

/**
 * Render a React element under jsdom without imposing an `act`
 * boundary. Replaces the 20-line hand-rolled `createRoot` + container
 * + `act` boilerplate used by ~60 test files before this helper
 * existed.
 *
 * Returns the standard RTL result plus a `flushAnimationFrames`
 * helper for tests that drive `requestAnimationFrame` directly.
 */
export function renderInJsdom(
  element: React.ReactNode,
  options?: RenderOptions,
): RenderResult & { flushAnimationFrames: (frames?: number) => Promise<void> } {
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
