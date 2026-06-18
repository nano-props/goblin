import { afterEach, describe, expect, test, vi } from 'vitest'

const hostInfoMock = vi.hoisted(() => ({
  homeDir: '/Users/server',
  platform: 'darwin' as NodeJS.Platform,
  hostname: 'test-host',
  pid: 999,
}))

vi.mock('#/server/modules/host-info.ts', () => ({
  getServerHostInfo: () => hostInfoMock,
}))

import { createHostRoutes } from '#/server/routes/host.ts'

describe('host routes', () => {
  afterEach(() => {
    hostInfoMock.homeDir = '/Users/server'
    hostInfoMock.platform = 'darwin'
    hostInfoMock.hostname = 'test-host'
    hostInfoMock.pid = 999
  })

  test('returns the server host info on GET /api/host', async () => {
    const app = createHostRoutes()
    const response = await app.request('http://localhost/')
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      homeDir: '/Users/server',
      platform: 'darwin',
      hostname: 'test-host',
      pid: 999,
    })
  })

  test('reflects the live process.platform / os values at request time', async () => {
    // The endpoint is intentionally a thin wrapper over
    // `getServerHostInfo()` — every call hits the live `os.homedir()`
    // and `process.platform`, so the route never caches stale values.
    hostInfoMock.homeDir = '/var/empty'
    hostInfoMock.platform = 'linux'

    const app = createHostRoutes()
    const response = await app.request('http://localhost/')
    const json = (await response.json()) as { homeDir: string; platform: string }

    expect(response.status).toBe(200)
    expect(json.homeDir).toBe('/var/empty')
    expect(json.platform).toBe('linux')
  })
})
