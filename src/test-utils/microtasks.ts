/** Drain a small, explicit number of promise-job rounds. */
export async function flushMicrotasks(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve()
}

/** Poll promise jobs without advancing timers; `vi.waitFor` cannot preserve that boundary under fake timers. */
export async function waitForMicrotaskCondition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('microtask condition was not met')
}

/** Cross exactly one real event-loop turn when macrotask ordering is the behavior under test. */
export async function waitForNextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
