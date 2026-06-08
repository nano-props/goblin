import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  existsSync: vi.fn(),
  homedir: vi.fn(() => '/Users/test'),
}))

vi.mock('execa', () => ({ execa: mocks.execa }))
vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}))
vi.mock('node:os', () => ({ default: { homedir: mocks.homedir } }))

function childProcessPromise() {
  const child = Promise.resolve({}) as Promise<unknown> & { unref: ReturnType<typeof vi.fn> }
  child.unref = vi.fn()
  return child
}

describe('openRemoteInGhostty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockImplementation((path: string) => path === '/Applications/Ghostty.app')
    mocks.execa.mockReturnValue(childProcessPromise())
  })

  test('opens a remote command in a running Ghostty window', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')
    mocks.execa.mockResolvedValueOnce({ stdout: 'opened' })

    await expect(openRemoteInGhostty('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-e', expect.stringContaining('input text'), expect.stringContaining('sh -lc')],
      expect.objectContaining({ timeout: 5_000, forceKillAfterDelay: 500 }),
    )
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
  })

  test('cold-starts Ghostty with ssh as the initial command when it is not running', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')
    mocks.execa.mockResolvedValueOnce({ stdout: 'not-running' })
    mocks.execa.mockReturnValueOnce(childProcessPromise())

    await expect(openRemoteInGhostty('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenLastCalledWith(
      'open',
      [
        '-na',
        'Ghostty.app',
        '--args',
        '-e',
        'ssh',
        '-tt',
        '--',
        'prod',
        expect.stringContaining('sh -lc'),
      ],
      expect.objectContaining({ detached: true, stdio: 'ignore', cleanup: false }),
    )
    expect(mocks.execa.mock.calls[1]![1][8]).toContain('/srv/repo-feature')
  })

  test('rejects invalid remote inputs before launching Ghostty', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')

    await expect(openRemoteInGhostty('bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteInGhostty('prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('returns ghostty-not-installed when Ghostty is unavailable', async () => {
    mocks.existsSync.mockReturnValue(false)
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')

    await expect(openRemoteInGhostty('prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.ghostty-not-installed',
    })
  })
})
