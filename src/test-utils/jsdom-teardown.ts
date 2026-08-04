// Vitest keeps Node's timer functions in jsdom; capture the host timer before
// a test can replace the global timer APIs with a fake clock.
const hostSetTimeout = globalThis.setTimeout

/** Cross one real host timer turn without advancing Vitest's fake clock. */
export async function waitForNextHostTimerTurn(): Promise<void> {
  await new Promise<void>((resolve) => hostSetTimeout(resolve, 0))
}
