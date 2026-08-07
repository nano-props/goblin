// Shared jsdom render helpers. Tests import `renderInJsdom` instead of
// hand-rolling `createRoot` + `container` + `act` boilerplate.
//
// Why a helper rather than `@testing-library/react` directly:
//   - RTL's `render` already wraps the synchronous mount in its own
//     `act()` boundary. Tests only add an explicit async `act()` around
//     the later operation that schedules React work, such as advancing
//     fake timers; wrapping the render again does not cover that work.
//   - `cleanup` is registered with `afterEach` so callers don't repeat
//     the import.
//   - `flushAnimationFrames` and the shared microtask helpers exist because
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
//     wrap the state-changing operation in `await act(async () => …)`.
//     Importing `act` from `react` directly does not set the test
//     environment flag and can emit "The current testing environment is
//     not configured to support act(...)". `renderInJsdom` does not
//     assume that need on the caller's behalf.

import { afterEach } from 'vitest'
import { cleanup, render, renderHook, type RenderOptions, type RenderResult } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

/** Render a hook through RTL while retaining this module's cleanup boundary. */
export const renderHookInJsdom = renderHook

/**
 * Render a React element under jsdom through RTL's synchronous `act`
 * boundary. Replaces hand-rolled `createRoot` + container boilerplate.
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
