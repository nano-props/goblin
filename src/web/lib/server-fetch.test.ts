// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const fetchMock = mockFetch()

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
    const request = fetchServerJson('/api/slow', { timeoutMs: 1_000 })
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
    const request = fetchServerJson('/api/slow', { signal: caller.signal, timeoutMs: 1_000 })
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
    await expect(fetchServerJson('/api/ok', { timeoutMs: 1_000 })).resolves.toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('supports disabling the request watchdog', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise(() => {})
    })

    const { fetchServerJson } = await import('#/web/lib/server-fetch.ts')
    void fetchServerJson('/api/slow', { timeoutMs: 0 })

    await Promise.resolve()
    expect(requestSignal).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
