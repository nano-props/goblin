import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  execa: execaMock,
}))

// Importing after the mock so the module under test picks up the mocked execa.
const { isWindowsTerminalInstalled, openInWindowsTerminal } = await import('#/system/windows-terminal.ts')

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT
const originalPlatform = process.platform
const tempDirs: string[] = []

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goblin-wt-test-'))
  tempDirs.push(dir)
  return dir
}

function makeFakeWindowsTerminal(dir: string): string {
  const exe = path.join(dir, 'wt.exe')
  writeFileSync(exe, '@echo off\r\n')
  return exe
}

afterEach(() => {
  process.env.PATH = originalPath
  if (originalPathExt === undefined) delete process.env.PATHEXT
  else process.env.PATHEXT = originalPathExt
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  execaMock.mockReset()
})

describe('isWindowsTerminalInstalled', () => {
  test('returns false on non-win32 platforms even when an executable is on PATH', () => {
    withPlatform('darwin', () => {
      const dir = makeTempDir()
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
      const dir = makeTempDir()
      const fake = makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'

      expect(isWindowsTerminalInstalled()).toBe(true)
      expect(existsSync(fake)).toBe(true)
    })
  })

  test('returns false on win32 when neither wt.exe nor WindowsApps fallback resolves', () => {
    withPlatform('win32', () => {
      const dir = makeTempDir()
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      process.env.LOCALAPPDATA = dir

      expect(isWindowsTerminalInstalled()).toBe(false)
    })
  })

  test('does not fall back to cmd.exe when wt.exe is missing', () => {
    withPlatform('win32', () => {
      const dir = makeTempDir()
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
    withPlatform('win32', async () => {
      const result = await openInWindowsTerminal('relative/path')
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('rejects paths containing NUL bytes', async () => {
    withPlatform('win32', async () => {
      const result = await openInWindowsTerminal('C:/valid\0/evil')
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('rejects paths that do not exist on disk', async () => {
    withPlatform('win32', async () => {
      const result = await openInWindowsTerminal('C:/definitely/does/not/exist-' + Date.now())
      expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('returns not-installed when wt.exe cannot be found', async () => {
    withPlatform('win32', async () => {
      const dir = makeTempDir()
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      process.env.LOCALAPPDATA = dir

      const result = await openInWindowsTerminal(process.cwd())
      expect(result).toEqual({ ok: false, message: 'error.terminal-not-installed' })
      expect(execaMock).not.toHaveBeenCalled()
    })
  })

  test('spawns wt.exe with -d <path> on success', async () => {
    withPlatform('win32', async () => {
      const dir = makeTempDir()
      const fake = makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      const unref = vi.fn()
      execaMock.mockReturnValue({ unref } as any)

      const target = process.cwd()
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
    withPlatform('win32', async () => {
      const dir = makeTempDir()
      makeFakeWindowsTerminal(dir)
      process.env.PATH = dir
      process.env.PATHEXT = '.EXE'
      execaMock.mockImplementation(() => {
        throw new Error('permission denied')
      })

      const result = await openInWindowsTerminal(process.cwd())
      expect(result).toEqual({ ok: false, message: 'permission denied' })
    })
  })
})

// Sanity: a real os.tmpdir() entry is a directory, so we use it to drive
// the absolute + isDirectory check without mocking statSync.
describe('os.tmpdir() round-trip', () => {
  test('process.cwd() is an absolute directory on every platform', () => {
    expect(path.isAbsolute(process.cwd())).toBe(true)
    expect(statSync(process.cwd()).isDirectory()).toBe(true)
  })
})

beforeEach(() => {
  // Make sure we start each test from a clean execa mock.
  execaMock.mockReset()
})
