// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { useLatestAsyncTask } from '#/web/hooks/useLatestAsyncTask.ts'
import type { LatestAsyncTaskResult } from '#/web/hooks/useLatestAsyncTask.ts'

describe('useLatestAsyncTask', () => {
  test('marks superseded results stale and keeps the latest result current', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const { result } = renderComposableInJsdom(useLatestAsyncTask)

    const firstPromise = result.value.runLatest(() => first.promise)
    const secondPromise = result.value.runLatest(() => second.promise)
    expect(result.value.pending.value).toBe(true)

    first.resolve('first')
    second.resolve('second')
    const results: Array<LatestAsyncTaskResult<string>> = await Promise.all([firstPromise, secondPromise])

    expect(results).toEqual([{ status: 'stale' }, { status: 'current', value: 'second' }])
    expect(result.value.pending.value).toBe(false)
  })

  test('reset invalidates in-flight work and clears pending state', async () => {
    const deferred = Promise.withResolvers<string>()
    const { result } = renderComposableInJsdom(useLatestAsyncTask)
    const pendingPromise = result.value.runLatest(() => deferred.promise)

    result.value.reset()
    expect(result.value.pending.value).toBe(false)

    deferred.resolve('done')
    expect(await pendingPromise).toEqual({ status: 'stale' })
  })
})
