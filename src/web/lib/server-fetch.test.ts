// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const fetchMock = mockFetch()
const decodeJson = (value: unknown) => value
type RequestKind = 'read' | 'post-query' | 'command'

async function requestJson(kind: RequestKind, decode: (value: unknown) => unknown = decodeJson) {
  const { fetchServerJson, postServerCommandJson, postServerJson } = await import('#/web/lib/server-fetch.ts')
  switch (kind) {
    case 'read':
      return await fetchServerJson('/api/settings', decode)
    case 'post-query':
      return await postServerJson('/api/repo/snapshot', { cwd: '/repo' }, decode)
    case 'command':
      return await postServerCommandJson('/api/settings/prefs', { prefs: {} }, decode)
  }
}

describe('server-fetch', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
  })

  test('times out hung requests with a stable error key and clears its timer', async () => {
    useFakeTimers()
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    const request = fetchServerJson('/api/slow', decodeJson, { timeoutMs: 1_000 })
    const assertion = expect(request).rejects.toMatchObject({ message: 'error.request-timeout' })

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  test('lets caller abort win over the watchdog timeout', async () => {
    useFakeTimers()
    const caller = new AbortController()
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    const request = fetchServerJson('/api/slow', decodeJson, { signal: caller.signal, timeoutMs: 1_000 })
    const assertion = expect(request).rejects.toThrow('caller cancelled')

    await Promise.resolve()
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(caller.signal)
    caller.abort(new Error('caller cancelled'))

    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  test('preserves query cancellation while reading a successful response body', async () => {
    const caller = new AbortController()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          caller.signal.addEventListener('abort', () => reject(caller.signal.reason), { once: true })
        }),
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    const request = fetchServerJson('/api/settings', decodeJson, { signal: caller.signal })
    await Promise.resolve()
    caller.abort(new Error('caller cancelled'))

    await expect(request).rejects.toBe(caller.signal.reason)
  })

  test('classifies command cancellation after fetch starts as indeterminate', async () => {
    const caller = new AbortController()
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { postServerCommandJson } = await import('#/web/lib/server-fetch.ts')
    const request = postServerCommandJson('/api/settings/prefs', { prefs: {} }, decodeJson, {
      signal: caller.signal,
    })
    await Promise.resolve()
    caller.abort(new Error('caller cancelled'))

    await expect(request).rejects.toMatchObject({
      name: 'CodedError',
      code: 'OUTCOME_UNCERTAIN',
    })
  })

  test('preserves a command cancellation that happened before fetch admission', async () => {
    const caller = new AbortController()
    caller.abort(new Error('caller cancelled'))
    fetchMock.mockRejectedValueOnce(caller.signal.reason)

    const { postServerCommandJson } = await import('#/web/lib/server-fetch.ts')

    await expect(
      postServerCommandJson('/api/settings/prefs', { prefs: {} }, decodeJson, { signal: caller.signal }),
    ).rejects.toBe(caller.signal.reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('clears the watchdog after a successful response', async () => {
    useFakeTimers()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    await expect(fetchServerJson('/api/ok', decodeJson, { timeoutMs: 1_000 })).resolves.toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('uses the explicit bootstrap server origin instead of the page origin', async () => {
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: { kind: 'web', bridgeVersion: 1, capabilities: [] },
        initialServer: { url: 'http://127.0.0.1:32101/', accessToken: 'secret' },
      },
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    await fetchServerJson('/api/settings', decodeJson)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32101/api/settings',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
  })

  test('supports disabling the request watchdog', async () => {
    useFakeTimers()
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise(() => {})
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    void fetchServerJson('/api/slow', decodeJson, { timeoutMs: 0 })

    await Promise.resolve()
    expect(requestSignal).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('preserves a structured server error message for domain handling', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'BAD_REQUEST', message: 'error.repository-boundary-unavailable' }),
    })

    const { fetchServerJson, ServerRequestError } = await import('#/web/lib/server-fetch.ts')
    await expect(fetchServerJson('/api/repo/fetch', decodeJson)).rejects.toMatchObject({
      name: 'ServerRequestError',
      message: 'error.repository-boundary-unavailable',
      status: 400,
      code: 'BAD_REQUEST',
    } satisfies Partial<InstanceType<typeof ServerRequestError>>)
  })

  test.each([
    {
      label: 'read request',
      kind: 'read' as const,
      expected: { name: 'Error', message: 'Server request failed' },
    },
    {
      label: 'POST query',
      kind: 'post-query' as const,
      expected: { name: 'Error', message: 'Server request failed' },
    },
    {
      label: 'command',
      kind: 'command' as const,
      expected: { name: 'CodedError', code: 'OUTCOME_UNCERTAIN' },
    },
  ])('classifies a transport failure for a $label', async ({ kind, expected }) => {
    fetchMock.mockRejectedValueOnce(new Error('connection reset'))

    await expect(requestJson(kind)).rejects.toMatchObject(expected)
  })

  test.each([
    {
      label: 'read response',
      kind: 'read' as const,
      expected: { name: 'Error', message: 'Server returned an invalid successful response' },
    },
    {
      label: 'command response',
      kind: 'command' as const,
      expected: { name: 'CodedError', code: 'OUTCOME_UNCERTAIN' },
    },
  ])('classifies an invalid successful $label', async ({ kind, expected }) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })

    await expect(
      requestJson(kind, () => {
        throw new Error('invalid payload')
      }),
    ).rejects.toMatchObject(expected)
  })
})
