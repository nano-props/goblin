import { expect, test, vi } from 'vitest'
import { waitForNextHostTimerTurn } from '#/test-utils/jsdom-teardown.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'

test('crosses the host timer turn after callbacks that are already queued', async () => {
  const queuedCallback = vi.fn()
  setTimeout(queuedCallback, 0)

  await waitForNextHostTimerTurn()

  expect(queuedCallback).toHaveBeenCalledOnce()
})

test('does not advance unrelated fake timers', async () => {
  useFakeTimers()
  const unrelatedFakeTimer = vi.fn()
  setTimeout(unrelatedFakeTimer, 1_000)

  await waitForNextHostTimerTurn()

  expect(unrelatedFakeTimer).not.toHaveBeenCalled()
})
