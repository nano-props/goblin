// @vitest-environment jsdom

import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccessTokenStatus } from '#/web/hooks/useAccessTokenStatus.ts'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

vi.mock('#/web/lib/server-fetch.ts', () => ({
  fetchServerJson: vi.fn(),
  postServerJson: vi.fn(),
}))

beforeEach(() => {
  vi.useRealTimers()
  vi.mocked(fetchServerJson).mockReset()
  vi.mocked(postServerJson).mockReset()
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAccessTokenStatus', () => {
  test('moves back to checking while a manual refresh probe is pending', async () => {
    const refreshProbe = createDeferred<{ ok: true }>()
    vi.mocked(fetchServerJson)
      .mockRejectedValueOnce(new Error('unauthorized'))
      .mockReturnValueOnce(refreshProbe.promise)

    renderInJsdom(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    })

    await act(async () => {
      screen.getByRole('button', { name: 'unauthenticated' }).click()
    })

    expect(screen.getByRole('button', { name: 'checking' })).toBeTruthy()
    expect(fetchServerJson).toHaveBeenCalledTimes(2)
    expect(fetchServerJson).toHaveBeenLastCalledWith('/api/whoami', { signal: expect.any(AbortSignal) })

    await act(async () => {
      refreshProbe.resolve({ ok: true })
      await refreshProbe.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'authenticated' })).toBeTruthy()
    })
  })

  test('aborts a hanging whoami probe after the auth status timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchServerJson).mockImplementation((_path, init) => {
      const signal = init?.signal
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    renderInJsdom(<Harness />)

    expect(screen.getByRole('button', { name: 'checking' })).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchServerJson).toHaveBeenCalledWith('/api/whoami', { signal: expect.any(AbortSignal) })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    expect(vi.mocked(fetchServerJson).mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  test('strips a URL token before the login request settles', async () => {
    const login = createDeferred<{ ok: true }>()
    vi.mocked(postServerJson).mockReturnValue(login.promise)
    window.history.replaceState({}, '', '/?accessToken=url-token&x=1')

    renderInJsdom(<Harness />)

    expect(postServerJson).toHaveBeenCalledWith('/api/login', { token: 'url-token' }, { signal: expect.any(AbortSignal) })
    expect(window.location.search).toBe('?x=1')

    await act(async () => {
      login.resolve({ ok: true })
      await login.promise
    })
  })

  test('clears the auth timeout when URL token login fails before whoami', async () => {
    vi.useFakeTimers()
    vi.mocked(postServerJson).mockRejectedValueOnce(new Error('bad token'))
    window.history.replaceState({}, '', '/?accessToken=bad-token')

    renderInJsdom(<Harness />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    expect(fetchServerJson).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(window.location.search).toBe('')
  })
})

function Harness() {
  const auth = useAccessTokenStatus()
  return (
    <button type="button" onClick={auth.refresh}>
      {auth.state}
    </button>
  )
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
