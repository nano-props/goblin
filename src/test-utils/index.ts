// Barrel for cross-cutting test utilities. Web-only helpers live under
// `src/web/test-utils/` and are re-exported from there.

export { renderInJsdom, flushMicrotasks } from './render.tsx'
export { useFakeTimers, advanceTimersAndFlush } from './timers.ts'
