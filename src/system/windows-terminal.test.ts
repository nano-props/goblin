import { chmodSync, mkdtempDisposableSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  execa: execaMock,
}))

// Importing after the mock so the module under test picks up the mocked execa.
const { isWindowsTerminalInstalled, openInWindowsTerminal } = await import('#/system/windows-terminal.ts')

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT
const originalLocalAppData = process.env.LOCALAPPDATA
const originalPlatform = process.platform

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
}

async function withPlatformAsync(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
}

function makeTempDir() {
  return mkdtempDisposableSync(path.join(os.tmpdir(), 'goblin-wt-test-'))
}

function makeFakeWindowsTerminal(dir: string): string {
  const exe = path.join(dir, 'wt.exe')
  writeFileSync(exe, '@echo off\r\n')
  return exe
}

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalPathExt === undefined) delete process.env.PATHEXT
  else process.env.PATHEXT = originalPathExt
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = originalLocalAppData
  execaMock.mockReset()
})

describe('isWindowsTerminalInstalled', () => {
  test('returns false on non-win32 platforms even when an executable is on PATH', () => {
    withPlatform('darwin', () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      const fake = path.join(dir, 'wt.exe')
      writeFileSync(fake, '')
      chmodSync(fake, 0o755)
      process.env.PATH = dir
      delete process.env.PATHEXT

      expect(isWindowsTerminalInstalled()).toBe(false)
    })
  })

  test('returns true on win32 when wt.exe is on PATH', () => {
    withPlatform('win32', () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'

      expect(isWindowsTerminalInstalled()).toBe(true)
    })
  })

  test('returns false on win32 when neither wt.exe nor WindowsApps fallback resolves', () => {
    withPlatform('win32', () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      process.env.LOCALAPPDATA = dir

      expect(isWindowsTerminalInstalled()).toBe(false)
    })
  })

  test('does not fall back to cmd.exe when wt.exe is missing', () => {
    withPlatform('win32', () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      const cmd = path.join(dir, 'cmd.exe')
      writeFileSync(cmd, '@echo off\r\n')
      // Only cmd.exe is present. We expect isInstalled to stay false so the
      // settings UI doesn't claim Windows Terminal is available on stock
      // Windows machines that don't have it from the Microsoft Store.
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      process.env.LOCALAPPDATA = dir

      expect(isWindowsTerminalInstalled()).toBe(false)
    })
  })
})

describe('openInWindowsTerminal', () => {
  test('rejects relative paths', async () => {
    await withPlatformAsync('win32', async () => {
      const result = await openInWindowsTerminal('relative/path')
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('rejects paths containing NUL bytes', async () => {
    await withPlatformAsync('win32', async () => {
      const result = await openInWindowsTerminal('C:/valid\0/evil')
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('rejects paths that do not exist on disk', async () => {
    await withPlatformAsync('win32', async () => {
      const result = await openInWindowsTerminal('C:/definitely/does/not/exist-' + Date.now())
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('returns not-installed when wt.exe cannot be found', async () => {
    await withPlatformAsync('win32', async () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      process.env.LOCALAPPDATA = dir

      // Use the same temp dir we already created — guaranteed
      // absolute + isDirectory(), with no dependency on the test
      // runner's CWD (which can vary across sandbox / symlink layouts).
      const target = dir
      const result = await openInWindowsTerminal(target)
      expect(result).toEqual({ ok: false, message: 'error.terminal-not-installed' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('spawns wt.exe with -d <path> on success', async () => {
    await withPlatformAsync('win32', async () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      const fake = makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      const unref = vi.fn()
      execaMock.mockReturnValue({ nodeChildProcess: { unref } })

      // Open the temp dir we already set up — absolute + isDirectory()
      // are guaranteed, and the assertion below checks the exact string
      // we passed in.
      const target = dir
      const result = await openInWindowsTerminal(target)

      expect(execaMock).toHaveBeenCalledWith(
        fake,
        ['-d', target],
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      )
      expect(unref).toHaveBeenCalled()
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.message).toBe(target)
    })
  })

  test('returns the error message when wt.exe fails to spawn', async () => {
    await withPlatformAsync('win32', async () => {
      using temporaryDirectory = makeTempDir()
      const dir = temporaryDirectory.path
      makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      execaMock.mockImplementation(() => {
        throw new Error('permission denied')
      })

      const result = await openInWindowsTerminal(dir)
      expect(result).toEqual({ ok: false, message: 'permission denied' })
    })
  })
})
