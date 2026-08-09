// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { useActionFeedback } from '#/web/hooks/useActionFeedback.ts'

describe('useActionFeedback', () => {
  test('does not publish feedback or allocate a timer after its owner unmounts', async () => {
    useFakeTimers()
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    const accepted = Promise.withResolvers<boolean>()
    const { result, unmount } = renderComposableInJsdom(useActionFeedback)

    result.value.trigger(() => accepted.promise)
    unmount()
    const timersBeforeSettlement = setTimeoutSpy.mock.calls.length
    accepted.resolve(true)
    await flushMicrotasks()

    expect(result.value.succeeded.value).toBe(false)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(timersBeforeSettlement)
  })
})
