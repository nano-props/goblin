/** Drain a small, explicit number of promise-job rounds. */
export async function flushMicrotasks(ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve()
}
