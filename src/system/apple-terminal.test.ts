import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('execa', () => ({ execa: mocks.execa }))
vi.mock('node:fs', () => ({
  statSync: mocks.statSync,
}))

describe('openRemoteInAppleTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    mocks.execa.mockResolvedValue({})
  })

  test('opens Terminal.app with a prepared ssh command', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('tell application "Terminal"'),
        expect.stringContaining('ssh'),
      ],
      expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
    )
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
  })

  test('rejects invalid remote inputs before invoking osascript', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteInAppleTerminal('prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })
})
