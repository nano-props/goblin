// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const fetchMock = mockFetch()
const decodeJson = (value: unknown) => value

describe('server-fetch', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('times out hung requests with a stable error key and clears its timer', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    const request = fetchServerJson('/api/slow', decodeJson, { timeoutMs: 1_000 })
    const assertion = expect(request).rejects.toThrow('error.request-timeout')

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  test('lets caller abort win over the watchdog timeout', async () => {
    vi.useFakeTimers()
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

  test('clears the watchdog after a successful response', async () => {
    vi.useFakeTimers()
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
    vi.useFakeTimers()
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
})
