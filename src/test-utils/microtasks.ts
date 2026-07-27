/** Drain a small, explicit number of promise-job rounds. */
export async function flushMicrotasks(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve()
}

/** Cross exactly one real event-loop turn when macrotask ordering is the behavior under test. */
export async function waitForNextMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
