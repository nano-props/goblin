// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('useAsyncPending', () => {
  test('runs when resetKey is omitted', () => {
    const onRun = vi.fn()
    const apiRef: { current: ReturnType<typeof useAsyncPending<string>> | null } = { current: null }

    renderInJsdom(
      <UseAsyncPendingHarness
        onReady={(nextApi) => {
          apiRef.current = nextApi
        }}
      />,
    )

    act(() => {
      apiRef.current?.run('sync', onRun)
    })

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.hasPending()).toBe(false)
  })

  test('resetKey clears pending without letting older promises clear newer pending', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const apiRef: { current: ReturnType<typeof useAsyncPending<string>> | null } = { current: null }

    const view = renderInJsdom(
      <UseAsyncPendingHarness
        resetKey="a"
        onReady={(nextApi) => {
          apiRef.current = nextApi
        }}
      />,
    )

    await act(async () => {
      apiRef.current?.run('first', () => first.promise)
    })

    expect(apiRef.current?.pending).toBe('first')

    act(() => {
      view.rerender(
        <UseAsyncPendingHarness
          resetKey="b"
          onReady={(nextApi) => {
            apiRef.current = nextApi
          }}
        />,
      )
    })

    expect(apiRef.current?.pending).toBeNull()
    expect(apiRef.current?.hasPending()).toBe(false)

    await act(async () => {
      apiRef.current?.run('second', () => second.promise)
    })

    expect(apiRef.current?.pending).toBe('second')

    await act(async () => {
      first.resolve()
      await first.promise
    })

    expect(apiRef.current?.pending).toBe('second')

    await act(async () => {
      second.resolve()
      await second.promise
    })

    expect(apiRef.current?.pending).toBeNull()
  })
})

function UseAsyncPendingHarness({
  resetKey,
  onReady,
}: {
  resetKey?: string
  onReady: (api: ReturnType<typeof useAsyncPending<string>>) => void
}) {
  const api = useAsyncPending<string>({ resetKey })
  onReady(api)
  return null
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
