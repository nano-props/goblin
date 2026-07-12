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

  test('opens Terminal.app with a cleared exec ssh command and readable title', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('set custom title of remoteTab to titleText'),
        expect.stringContaining('clear; exec ssh'),
        'prod:/srv/repo-feature',
      ],
      expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
    )
    const commandText = mocks.execa.mock.calls[0]![1][2]
    expect(commandText).toContain("'prod'")
    expect(commandText).toContain('/srv/repo-feature')
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
