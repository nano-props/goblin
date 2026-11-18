import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

import { openGoblin } from '#/server/open.ts'

describe('open a workspace URL in the browser', () => {
  const fetchMock = mockFetch()

  beforeEach(() => {
    vi.stubEnv('GOBLIN_SERVER_HOST', '127.0.0.1')
    vi.stubEnv('GOBLIN_SERVER_PORT', '43210')
    mocks.spawn.mockImplementation(() => {
      const launcher = Object.assign(new EventEmitter(), { unref: vi.fn() })
      queueMicrotask(() => launcher.emit('spawn'))
      return launcher
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllEnvs())

  test('opens the current directory without contacting the server', async () => {
    await openGoblin([])
    const url = new URL('http://127.0.0.1:43210/open')
    url.searchParams.set('path', process.cwd())
    expect(mocks.spawn).toHaveBeenCalledWith(process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href], {
      detached: true,
      stdio: 'ignore',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('encodes spaces, Unicode, query characters, and shell metacharacters as one path', async () => {
    const directory = './example 项目&query#fragment;$(false)'
    await openGoblin([directory])
    const url = new URL('http://127.0.0.1:43210/open')
    url.searchParams.set('path', path.resolve(directory))
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), [url.href], {
      detached: true,
      stdio: 'ignore',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('overrides environment settings and maps bind-all to loopback', async () => {
    await openGoblin(['--host', '::', '--port', '43211', '/srv/example'])
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      ['http://[::1]:43211/open?path=%2Fsrv%2Fexample'],
      expect.any(Object),
    )
  })

  test('reports a manual URL if the browser launcher is unavailable', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      const launcher = new EventEmitter()
      queueMicrotask(() => launcher.emit('error', new Error('missing launcher')))
      return launcher
    })
    await expect(openGoblin(['/srv/example'])).rejects.toThrow(
      'Open http://127.0.0.1:43210/open?path=%2Fsrv%2Fexample manually',
    )
  })

  test.each([
    [' https://example.com/ ', 'https://example.com'],
    ['http://example.com:8080', 'http://example.com:8080'],
  ])('opens the workspace at the explicit server origin %s', async (address, origin) => {
    await openGoblin(['--url', address, '/srv/example'])
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      [`${origin}/open?path=%2Fsrv%2Fexample`],
      expect.any(Object),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each([
    'example.com',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com/app',
    'https://example.com/?query',
    'https://example.com/#fragment',
    'https://exa\nmple.com',
    'https://exa\tmple.com',
  ])('rejects an invalid server origin %s', async (address) => {
    await expect(openGoblin(['--url', address])).rejects.toThrow('Provide an HTTP or HTTPS server origin')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  test.each([
    ['--host', 'example.com'],
    ['--port', '8080'],
  ])('rejects combining --url with %s', async (option, value) => {
    await expect(openGoblin(['--url', 'https://example.com', option, value])).rejects.toThrow('Use --url by itself')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  test.each([['first', 'second'], ['--token', 'example'], ['/' + 'a'.repeat(4096)], ['/srv/line\nbreak']])(
    'rejects invalid input without launching a browser: %j',
    async (...args) => {
      await expect(openGoblin(args)).rejects.toThrow()
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
