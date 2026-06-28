// @vitest-environment jsdom

import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useLatestAsyncTask } from '#/web/hooks/useLatestAsyncTask.ts'

describe('useLatestAsyncTask', () => {
  test('marks superseded task results as stale and keeps latest result current', async () => {
    const first = createDeferred<string>()
    const second = createDeferred<string>()
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

    let firstPromise!: Promise<unknown>
    let secondPromise!: Promise<unknown>
    await act(async () => {
      firstPromise = latestTask!.runLatest(() => first.promise)
      secondPromise = latestTask!.runLatest(() => second.promise)
      await Promise.resolve()
    })

    expect(latestTask!.pending).toBe(true)

    await act(async () => {
      first.resolve('first')
      second.resolve('second')
      await Promise.resolve()
    })

    await expect(firstPromise).resolves.toEqual({ status: 'stale' })
    await expect(secondPromise).resolves.toEqual({ status: 'current', value: 'second' })

    await flush()
    expect(latestTask!.pending).toBe(false)
  })

  test('reset invalidates the in-flight task and clears pending', async () => {
    const deferred = createDeferred<string>()
    let latestTask: ReturnType<typeof useLatestAsyncTask> | undefined

    function HookHost() {
      latestTask = useLatestAsyncTask()
      return null
    }

    render(<HookHost />)

    let pendingPromise!: Promise<unknown>
    await act(async () => {
      pendingPromise = latestTask!.runLatest(() => deferred.promise)
      await Promise.resolve()
    })
    expect(latestTask!.pending).toBe(true)

    act(() => {
      latestTask!.reset()
    })

    expect(latestTask!.pending).toBe(false)

    await act(async () => {
      deferred.resolve('done')
      await Promise.resolve()
    })
    await expect(pendingPromise).resolves.toEqual({ status: 'stale' })
  })
})

function render(element: ReactNode) {
  return renderInJsdom(element)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
