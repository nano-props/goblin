// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { useLatestAsyncTask, type LatestAsyncTaskResult } from '#/web/hooks/useLatestAsyncTask.ts'
import { renderHookInJsdom } from '#/test-utils/render.tsx'

describe('useLatestAsyncTask', () => {
  test('marks superseded task results as stale and keeps latest result current', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const { result } = renderHookInJsdom(() => useLatestAsyncTask())

    const { firstPromise, secondPromise } = await act(async () => {
      const firstPromise = result.current.runLatest(() => first.promise)
      const secondPromise = result.current.runLatest(() => second.promise)
      return { firstPromise, secondPromise }
    })

    await waitFor(() => {
      expect(result.current.pending).toBe(true)
    })

    let results: Array<LatestAsyncTaskResult<string>> = []
    await act(async () => {
      first.resolve('first')
      second.resolve('second')
      results = await Promise.all([firstPromise, secondPromise])
    })

    expect(results).toEqual([{ status: 'stale' }, { status: 'current', value: 'second' }])
    expect(result.current.pending).toBe(false)
  })

  test('reset invalidates the in-flight task and clears pending', async () => {
    const deferred = Promise.withResolvers<string>()
    const { result } = renderHookInJsdom(() => useLatestAsyncTask())

    const { pendingPromise } = await act(async () => {
      const pendingPromise = result.current.runLatest(() => deferred.promise)
      return { pendingPromise }
    })
    await waitFor(() => {
      expect(result.current.pending).toBe(true)
    })

    act(() => {
      result.current.reset()
    })

    expect(result.current.pending).toBe(false)

    const taskResult = await act(async () => {
      deferred.resolve('done')
      return await pendingPromise
    })
    expect(taskResult).toEqual({ status: 'stale' })
  })

  test('clears pending state after StrictMode replays the mount effect', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const { result } = renderHookInJsdom(() => useLatestAsyncTask(), { wrapper: StrictModeHarness })

    const { firstPromise } = await act(async () => {
      const firstPromise = result.current.runLatest(() => first.promise)
      return { firstPromise }
    })
    await waitFor(() => expect(result.current.pending).toBe(true))

    act(() => result.current.reset())
    expect(result.current.pending).toBe(false)

    const { secondPromise } = await act(async () => {
      const secondPromise = result.current.runLatest(() => second.promise)
      return { secondPromise }
    })
    await waitFor(() => expect(result.current.pending).toBe(true))

    await act(async () => {
      first.resolve('stale')
      second.resolve('current')
      await Promise.all([firstPromise, secondPromise])
    })
    expect(result.current.pending).toBe(false)
  })
})

function StrictModeHarness({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>
}
