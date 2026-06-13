import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInPreferredTerminal, openRemoteInPreferredTerminal } from '#/system/terminals.ts'
import { openInAppleTerminal, openRemoteInAppleTerminal, isAppleTerminalInstalled } from '#/system/apple-terminal.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/system/ghostty.ts'
import { isWindowsTerminalInstalled, openInWindowsTerminal } from '#/system/windows-terminal.ts'

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

vi.mock('#/system/windows-terminal.ts', () => ({
  isWindowsTerminalInstalled: vi.fn(() => false),
  openInWindowsTerminal: vi.fn(async (path: string) => ({ ok: true, message: path })),
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

  test('opens Windows Terminal explicitly on win32 when detection reports available', async () => {
    setPlatform('win32')
    vi.mocked(isWindowsTerminalInstalled).mockReturnValue(true)

    await expect(openInPreferredTerminal('C:\\repo', 'windowsTerminal')).resolves.toEqual({
      ok: true,
      message: 'C:\\repo',
    })

    expect(openInWindowsTerminal).toHaveBeenCalledWith('C:\\repo')
    expect(openInAppleTerminal).not.toHaveBeenCalled()
    expect(openInGhostty).not.toHaveBeenCalled()
  })

  test('falls back to Windows Terminal in auto mode on win32', async () => {
    setPlatform('win32')
    vi.mocked(isWindowsTerminalInstalled).mockReturnValue(true)

    await expect(openInPreferredTerminal('C:\\repo', 'auto')).resolves.toEqual({
      ok: true,
      message: 'C:\\repo',
    })

    expect(openInWindowsTerminal).toHaveBeenCalledWith('C:\\repo')
  })
})

describe('openRemoteInPreferredTerminal', () => {
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

  test('opens the SSH session in Ghostty when chosen explicitly', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo', 'ghostty')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo',
    })
    expect(openRemoteInGhostty).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('opens the SSH session in Apple Terminal when chosen explicitly', async () => {
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo', 'terminal')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo',
    })
    expect(openRemoteInAppleTerminal).toHaveBeenCalledWith('prod', '/srv/repo')
  })

  test('prefers Ghostty for remote in auto mode when installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await openRemoteInPreferredTerminal('prod', '/srv/repo', 'auto')

    expect(openRemoteInGhostty).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns error.terminal-not-installed when nothing resolves', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })
    expect(openRemoteInGhostty).not.toHaveBeenCalled()
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns error.remote-terminal-not-supported when the resolved backend has no openRemote', async () => {
    setPlatform('win32')
    vi.mocked(isWindowsTerminalInstalled).mockReturnValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo', 'windowsTerminal')).resolves.toEqual({
      ok: false,
      message: 'error.remote-terminal-not-supported',
    })
    expect(openInWindowsTerminal).not.toHaveBeenCalled()
  })
})
