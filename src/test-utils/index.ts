// Barrel for cross-cutting test utilities. Web-only helpers live under
// `src/web/test-utils/` and are re-exported from there.

export { renderInJsdom, flushMicrotasks, cleanupAfterEach } from './render.tsx'
export { useFakeTimers, advanceTimersAndFlush } from './timers.ts'
