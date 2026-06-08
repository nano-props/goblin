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

describe('openRemoteByAppCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockImplementation((path: string) =>
      path === '/Applications/Visual Studio Code.app' ||
      path === '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    )
    mocks.execa.mockResolvedValue({ failed: false })
  })

  test('opens a VS Code-family editor with Remote SSH arguments', async () => {
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ['--remote', 'ssh-remote+prod', '/srv/repo-feature'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test('rejects invalid remote aliases and paths before invoking the editor', async () => {
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('returns editor-not-installed when the CLI cannot be found', async () => {
    mocks.existsSync.mockReturnValue(false)
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.editor-not-installed',
    })
  })

  test('returns CLI error output when the editor command fails', async () => {
    mocks.execa.mockResolvedValue({
      failed: true,
      stderr: 'Remote SSH extension is unavailable',
      shortMessage: 'failed',
      message: 'failed',
    })
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'Remote SSH extension is unavailable',
    })
  })
})
