// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useLatestAsyncTask, type LatestAsyncTaskResult } from '#/web/hooks/useLatestAsyncTask.ts'

describe('useLatestAsyncTask', () => {
  test('marks superseded task results as stale and keeps latest result current', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    let latestTask:
      | {
          pending: boolean
          runLatest: ReturnType<typeof useLatestAsyncTask>['runLatest']
        }
      | undefined

    function HookHost() {
      latestTask = useLatestAsyncTask()
      return null
    }

    render(<HookHost />)

    let firstPromise!: Promise<LatestAsyncTaskResult<string>>
    let secondPromise!: Promise<LatestAsyncTaskResult<string>>
    act(() => {
      firstPromise = latestTask!.runLatest(() => first.promise)
      secondPromise = latestTask!.runLatest(() => second.promise)
    })

    await waitFor(() => {
      expect(latestTask!.pending).toBe(true)
    })

    let results: Array<LatestAsyncTaskResult<string>> = []
    await act(async () => {
      first.resolve('first')
      second.resolve('second')
      results = await Promise.all([firstPromise, secondPromise])
    })

    expect(results).toEqual([{ status: 'stale' }, { status: 'current', value: 'second' }])
    expect(latestTask!.pending).toBe(false)
  })

  test('reset invalidates the in-flight task and clears pending', async () => {
    const deferred = Promise.withResolvers<string>()
    let latestTask: ReturnType<typeof useLatestAsyncTask> | undefined

    function HookHost() {
      latestTask = useLatestAsyncTask()
      return null
    }

    render(<HookHost />)

    let pendingPromise!: Promise<LatestAsyncTaskResult<string>>
    act(() => {
      pendingPromise = latestTask!.runLatest(() => deferred.promise)
    })
    await waitFor(() => {
      expect(latestTask!.pending).toBe(true)
    })

    act(() => {
      latestTask!.reset()
    })

    expect(latestTask!.pending).toBe(false)

    let result: LatestAsyncTaskResult<string> | undefined
    await act(async () => {
      deferred.resolve('done')
      result = await pendingPromise
    })
    expect(result).toEqual({ status: 'stale' })
  })
})

function render(element: ReactNode) {
  return renderInJsdom(element)
}
