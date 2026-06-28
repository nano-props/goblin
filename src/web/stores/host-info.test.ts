// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const fetchMock = mockFetch()

describe('useHostInfoStore', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    useHostInfoStore.setState({ snapshot: null, hydrated: false })
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

    await useHostInfoStore.getState().hydrate()

    const snapshot = useHostInfoStore.getState().snapshot
    expect(snapshot).toEqual({
      homeDir: '/Users/tester',
      platform: 'darwin',
      hostname: 'tester-host',
      pid: 1,
    })
    expect(useHostInfoStore.getState().hydrated).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0]?.[0]
    const urlString = typeof url === 'string' ? url : (url as URL).toString()
    // `fetchServerJson` resolves the path against `window.location.origin`
    // (or the test jsdom's `http://localhost:3000`); the path itself
    // is what we care about.
    expect(urlString).toContain('/api/host')
  })

  test('marks the store hydrated on network failure (callers fall back to defaults)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await useHostInfoStore.getState().hydrate()

    expect(useHostInfoStore.getState().snapshot).toBeNull()
    expect(useHostInfoStore.getState().hydrated).toBe(true)
  })

  test('returns the cached snapshot via the homeDirectory / getPlatform helpers', async () => {
    useHostInfoStore.setState({
      snapshot: { homeDir: '/Users/cached', platform: 'linux', hostname: 'cache', pid: 7 },
      hydrated: true,
    })

    // Re-import after the manual setState to get a fresh module
    // reference. The helpers read from the live store state, so
    // they pick up the cached value without any re-fetch.
    const { homeDirectory, getPlatform } = await import('#/web/stores/host-info.ts')
    expect(homeDirectory()).toBe('/Users/cached')
    expect(getPlatform()).toBe('linux')
  })

  test('returns safe defaults before the hydrate resolves', async () => {
    // No hydrate called yet — `homeDirectory()` should be `''` and
    // `getPlatform()` should be `'web'`, matching the pre-refactor
    // bootstrap defaults. This is the contract the client's
    // first-paint consumers depend on.
    const { homeDirectory, getPlatform } = await import('#/web/stores/host-info.ts')
    expect(homeDirectory()).toBe('')
    expect(getPlatform()).toBe('web')
  })
})
