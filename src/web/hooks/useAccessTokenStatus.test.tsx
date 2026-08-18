// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/vue'
import { defineComponent } from 'vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { CodedError } from '#/shared/coded-error.ts'
import { useAccessTokenStatus } from '#/web/hooks/useAccessTokenStatus.ts'
import { fetchServerJson, postServerCommandJson, ServerRequestError } from '#/web/lib/server-fetch.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const serverFetchMocks = vi.hoisted(() => ({
  fetchServerJson: vi.fn(),
  postServerCommandJson: vi.fn(),
}))

vi.mock('#/web/lib/server-fetch.ts', async (importOriginal) => {
  const actual = await importOriginal<{ ServerRequestError: typeof ServerRequestError }>()
  return {
    fetchServerJson: serverFetchMocks.fetchServerJson,
    postServerCommandJson: serverFetchMocks.postServerCommandJson,
    ServerRequestError: actual.ServerRequestError,
  }
})

beforeEach(() => {
  vi.mocked(fetchServerJson).mockReset()
  vi.mocked(postServerCommandJson).mockReset()
  window.history.replaceState({}, '', '/')
})

describe('useAccessTokenStatus', () => {
  test('moves back to checking while a manual refresh probe is pending', async () => {
    const refreshProbe = Promise.withResolvers<{ ok: true }>()
    vi.mocked(fetchServerJson)
      .mockRejectedValueOnce(new ServerRequestError({ status: 401, message: 'unauthorized' }))
      .mockReturnValueOnce(refreshProbe.promise)

    renderInJsdom(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    })

    await flushTestUpdates(async () => {
      screen.getByRole('button', { name: 'unauthenticated' }).click()
    })

    expect(screen.getByRole('button', { name: 'checking' })).toBeTruthy()
    expect(fetchServerJson).toHaveBeenCalledTimes(2)
    expect(fetchServerJson).toHaveBeenLastCalledWith('/api/whoami', expect.any(Function), {
      signal: expect.any(AbortSignal),
    })

    await flushTestUpdates(async () => {
      refreshProbe.resolve({ ok: true })
      await refreshProbe.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'authenticated' })).toBeTruthy()
    })
  })

  test('aborts a hanging whoami probe after the auth status timeout', async () => {
    useFakeTimers()
    vi.mocked(fetchServerJson).mockImplementation((_path, _decode, init) => {
      const signal = init?.signal
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    renderInJsdom(<Harness />)

    expect(screen.getByRole('button', { name: 'checking' })).toBeTruthy()
    await flushTestUpdates(async () => {
      await Promise.resolve()
    })
    expect(fetchServerJson).toHaveBeenCalledWith('/api/whoami', expect.any(Function), {
      signal: expect.any(AbortSignal),
    })

    await flushTestUpdates(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'unavailable' })).toBeTruthy()
    expect(vi.mocked(fetchServerJson).mock.calls[0]?.[2]?.signal?.aborted).toBe(true)
  })

  test('keeps a network failure distinct from an unauthenticated response', async () => {
    vi.mocked(fetchServerJson).mockRejectedValueOnce(new Error('network unavailable'))

    renderInJsdom(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'unavailable' })).toBeTruthy()
    })
  })

  test('keeps a server failure distinct from an unauthenticated response', async () => {
    vi.mocked(fetchServerJson).mockRejectedValueOnce(new ServerRequestError({ status: 500 }))

    renderInJsdom(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'unavailable' })).toBeTruthy()
    })
  })

  test('strips a URL token before login settles and authenticates after the cookie probe', async () => {
    const login = Promise.withResolvers<{ ok: true }>()
    vi.mocked(postServerCommandJson).mockReturnValue(login.promise)
    vi.mocked(fetchServerJson).mockResolvedValueOnce({ ok: true })
    window.history.replaceState({}, '', '/?accessToken=url-token&x=1')

    renderInJsdom(<Harness />)

    expect(postServerCommandJson).toHaveBeenCalledWith('/api/login', { token: 'url-token' }, expect.any(Function), {
      signal: expect.any(AbortSignal),
    })
    expect(window.location.search).toBe('?x=1')

    await flushTestUpdates(async () => {
      login.resolve({ ok: true })
      await login.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'authenticated' })).toBeTruthy()
    })
    expect(fetchServerJson).toHaveBeenCalledWith('/api/whoami', expect.any(Function), {
      signal: expect.any(AbortSignal),
    })
  })

  test('clears the auth timeout when URL token login fails before whoami', async () => {
    useFakeTimers()
    vi.mocked(postServerCommandJson).mockRejectedValueOnce(
      new ServerRequestError({ status: 401, message: 'bad token' }),
    )
    window.history.replaceState({}, '', '/?accessToken=bad-token')

    renderInJsdom(<Harness />)
    await flushTestUpdates(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    expect(fetchServerJson).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(window.location.search).toBe('')
  })

  test('does not classify an uncertain URL token login outcome as unauthenticated', async () => {
    vi.mocked(postServerCommandJson).mockRejectedValueOnce(
      new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'login outcome is uncertain' }),
    )
    window.history.replaceState({}, '', '/?accessToken=url-token')

    renderInJsdom(<Harness />)
    await flushTestUpdates(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'unavailable' })).toBeTruthy()
    expect(fetchServerJson).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })
})

const Harness = defineComponent({
  name: 'AccessTokenStatusTestHarness',
  setup() {
    const auth = useAccessTokenStatus()
    return () => (
      <button type="button" onClick={auth.refresh}>
        {auth.state}
      </button>
    )
  },
})
