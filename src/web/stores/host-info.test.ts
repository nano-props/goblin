// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const fetchMock = mockFetch()

describe('hostInfoStore', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    hostInfoStore.setState({ snapshot: null, status: 'pending', error: null })
  })

  test('hydrates from the public /api/host endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        homeDir: '/Users/tester',
        platform: 'darwin',
        hostname: 'tester-host',
        pid: 1,
      }),
    })

    await hostInfoStore.getState().hydrate()

    const snapshot = hostInfoStore.getState().snapshot
    expect(snapshot).toEqual({
      homeDir: '/Users/tester',
      platform: 'darwin',
      hostname: 'tester-host',
      pid: 1,
    })
    expect(hostInfoStore.getState().status).toBe('ready')
    expect(hostInfoStore.getState().error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0]?.[0]
    const urlString = typeof url === 'string' ? url : (url as URL).toString()
    // `fetchServerJson` resolves the path against `window.location.origin`
    // (or the test jsdom's `http://localhost:3000`); the path itself
    // is what we care about.
    expect(urlString).toContain('/api/host')
  })

  test('preserves network failure as an error until a successful retry', async () => {
    const failure = new Error('network down')
    fetchMock.mockRejectedValueOnce(failure).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ homeDir: '/Users/recovered', platform: 'darwin', hostname: 'host', pid: 2 }),
    })

    await expect(hostInfoStore.getState().hydrate()).rejects.toMatchObject({
      name: 'Error',
      message: 'Server request failed',
      cause: failure,
    })

    expect(hostInfoStore.getState().snapshot).toBeNull()
    expect(hostInfoStore.getState().status).toBe('error')
    expect(hostInfoStore.getState().error).toMatchObject({
      name: 'Error',
      message: 'Server request failed',
      cause: failure,
    })

    await expect(hostInfoStore.getState().hydrate()).resolves.toBeUndefined()
    expect(hostInfoStore.getState()).toMatchObject({
      status: 'ready',
      error: null,
      snapshot: { homeDir: '/Users/recovered', platform: 'darwin' },
    })
  })

  test('does not mark the store hydrated when hydrate is aborted', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce((_url, init) => {
      const signal = (init as { signal?: AbortSignal }).signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        })
      })
    })

    const hydrate = hostInfoStore.getState().hydrate({ signal: controller.signal })
    controller.abort(new Error('cancelled'))
    await expect(hydrate).rejects.toBe(controller.signal.reason)

    expect(hostInfoStore.getState().snapshot).toBeNull()
    expect(hostInfoStore.getState().status).toBe('error')
    expect(hostInfoStore.getState().error).toBe(controller.signal.reason)
  })

  test('returns the cached snapshot via the homeDirectory / getPlatform helpers', async () => {
    hostInfoStore.setState({
      snapshot: { homeDir: '/Users/cached', platform: 'linux', hostname: 'cache', pid: 7 },
      status: 'ready',
      error: null,
    })

    // Re-import after the manual setState to get a fresh module
    // reference. The helpers read from the live store state, so
    // they pick up the cached value without any re-fetch.
    const { homeDirectory, getPlatform } = await import('#/web/stores/host-info.ts')
    expect(homeDirectory()).toBe('/Users/cached')
    expect(getPlatform()).toBe('linux')
  })

  test('rejects authority reads before bootstrap succeeds', async () => {
    const { homeDirectory, getPlatform } = await import('#/web/stores/host-info.ts')
    expect(() => homeDirectory()).toThrow('Host info is unavailable before successful bootstrap')
    expect(() => getPlatform()).toThrow('Host info is unavailable before successful bootstrap')
  })
})
