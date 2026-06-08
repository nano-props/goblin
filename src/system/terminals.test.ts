import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  openInPreferredTerminal,
  openRemoteInPreferredTerminal,
  openRemoteInTerminalBackend,
} from '#/system/terminals.ts'
import { openInAppleTerminal, openRemoteInAppleTerminal, isAppleTerminalInstalled } from '#/system/apple-terminal.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/system/ghostty.ts'

vi.mock('#/system/ghostty.ts', () => ({
  isGhosttyInstalled: vi.fn(() => false),
  openInGhostty: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInGhostty: vi.fn(async (alias: string, path: string) => ({ ok: true, message: `${alias}:${path}` })),
}))

vi.mock('#/system/apple-terminal.ts', () => ({
  isAppleTerminalInstalled: vi.fn(async () => true),
  openInAppleTerminal: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInAppleTerminal: vi.fn(async (alias: string, path: string) => ({ ok: true, message: `${alias}:${path}` })),
}))

describe('openInPreferredTerminal', () => {
  const originalPlatform = process.platform

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setPlatform('darwin')
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  test('opens Terminal.app explicitly on darwin when detection reports available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openInPreferredTerminal('/repo', 'terminal')).resolves.toEqual({
      ok: true,
      message: '/repo',
    })
    expect(openInAppleTerminal).toHaveBeenCalledWith('/repo')
  })

  test('prefers Ghostty in auto mode when it is installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await openInPreferredTerminal('/repo', 'auto')

    expect(openInGhostty).toHaveBeenCalledWith('/repo')
    expect(openInAppleTerminal).not.toHaveBeenCalled()
  })

  test('falls back to Terminal.app in auto mode when detection reports available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openInPreferredTerminal('/repo', 'auto')).resolves.toEqual({
      ok: true,
      message: '/repo',
    })

    expect(openInAppleTerminal).toHaveBeenCalledWith('/repo')
  })

  test('does not open Terminal.app on darwin when detection reports unavailable', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openInPreferredTerminal('/repo', 'terminal')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })

    expect(openInAppleTerminal).not.toHaveBeenCalled()
  })

  test('does not expose Terminal.app on linux when selected explicitly', async () => {
    setPlatform('linux')
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openInPreferredTerminal('/repo', 'terminal')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })

    expect(openInAppleTerminal).not.toHaveBeenCalled()
    expect(openInGhostty).not.toHaveBeenCalled()
  })

  test('does not fall back to Terminal.app in auto mode on linux', async () => {
    setPlatform('linux')
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openInPreferredTerminal('/repo', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })

    expect(openInAppleTerminal).not.toHaveBeenCalled()
  })

  test('opens remote Terminal.app explicitly on darwin when detection reports available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'terminal')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo-feature',
    })

    expect(openRemoteInAppleTerminal).toHaveBeenCalledWith('prod', '/srv/repo-feature')
    expect(openRemoteInGhostty).not.toHaveBeenCalled()
  })

  test('prefers remote Ghostty in auto mode when it is installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'auto')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo-feature',
    })

    expect(openRemoteInGhostty).toHaveBeenCalledWith('prod', '/srv/repo-feature')
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns terminal-not-installed for remote open when no terminal is available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })

    expect(openRemoteInGhostty).not.toHaveBeenCalled()
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns remote-terminal-not-supported for backends without remote support', async () => {
    await expect(
      openRemoteInTerminalBackend(
        {
          isInstalled: () => true,
          open: async (path: string) => ({ ok: true, message: path }),
        },
        'prod',
        '/srv/repo-feature',
      ),
    ).resolves.toEqual({
      ok: false,
      message: 'error.remote-terminal-not-supported',
    })
  })
})
