// Barrel for cross-cutting test utilities. Web-only helpers live under
// `src/web/test-utils/` and are re-exported from there.

export { renderInJsdom } from './render.tsx'
export { flushMicrotasks } from './microtasks.ts'
export { useFakeTimers, advanceTimersAndFlush } from './timers.ts'
