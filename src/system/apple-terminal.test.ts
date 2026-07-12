import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('execa', () => ({ execa: mocks.execa }))
vi.mock('node:fs', () => ({ statSync: mocks.statSync }))

describe('openRemoteInAppleTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    mocks.execa.mockResolvedValue({})
  })

  test('opens Terminal.app with a scrollback-clearing exec ssh command and readable title', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.any(String),
        expect.stringContaining("printf '\\033[H\\033[2J\\033[3J'; exec ssh"),
        'prod:/srv/repo-feature',
      ],
      expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
    )
    const commandText = mocks.execa.mock.calls[0]![1][2]
    const script = mocks.execa.mock.calls[0]![1][1]
    expect(script).toContain('set custom title of remoteTab to titleText')
    expect(script.indexOf('if not terminalWasRunning then launch')).toBeLessThan(
      script.indexOf('set remoteTab to do script commandText'),
    )
    expect(script.indexOf('set remoteTab to do script commandText')).toBeLessThan(script.indexOf('activate'))
    expect(commandText).toContain("'prod'")
    expect(commandText).toContain('/srv/repo-feature')
    expect(commandText).not.toContain('clear;')
    expect(commandText).not.toMatch(/^'ssh'/)
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
