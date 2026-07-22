import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())
vi.mock('execa', () => ({ execa: execaMock }))

const existsSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: existsSyncMock }
})

// Importing after the mocks so the module under test picks up the mocked execa/fs.
const { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } = await import('#/system/ghostty.ts')

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goblin-ghostty-test-'))
  tempDirs.push(dir)
  return dir
}

/** Route the mocked `execa` by command: osascript calls resolve/reject a
 *  promise (the warm path awaits `.then` directly), `open` calls return an
 *  object exposing the underlying child process (the cold path unrefs it
 *  before awaiting). */
function mockOsascriptOnce(result: { stdout: string } | Error) {
  execaMock.mockImplementationOnce(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)))
}

function mockOpenOnce(result: 'ok' | Error) {
  execaMock.mockImplementationOnce(() => {
    if (result instanceof Error) throw result
    return { nodeChildProcess: { unref: vi.fn() } }
  })
}

afterEach(() => {
  execaMock.mockReset()
  existsSyncMock.mockReset()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('isGhosttyInstalled', () => {
  test('true when either known install path exists, false otherwise', () => {
    existsSyncMock.mockReturnValue(false).mockReturnValueOnce(true)
    expect(isGhosttyInstalled()).toBe(true)

    existsSyncMock.mockReturnValue(false)
    expect(isGhosttyInstalled()).toBe(false)
  })
})

describe('openInGhostty', () => {
  test('rejects an invalid path without touching execa', async () => {
    await expect(openInGhostty('relative/path')).resolves.toEqual({ ok: false, message: 'error.invalid-path' })
    expect(execaMock).not.toHaveBeenCalled()
  })

  test('returns not-installed when Ghostty.app is missing', async () => {
    existsSyncMock.mockReturnValue(false)
    const result = await openInGhostty(makeTempDir())
    expect(result).toEqual({ ok: false, message: 'error.ghostty-not-installed' })
    expect(execaMock).not.toHaveBeenCalled()
  })

  test('reuses a running instance via AppleScript when it opens a window', async () => {
    existsSyncMock.mockReturnValue(true)
    const dir = makeTempDir()
    mockOsascriptOnce({ stdout: 'opened' })

    const result = await openInGhostty(dir)

    expect(result).toEqual({ ok: true, message: dir })
    expect(execaMock).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['the check reports Ghostty is not running', { stdout: 'not-running' }],
    ['the check itself fails (e.g. times out)', new Error('osascript timed out')],
  ] as const)('falls back to launching without -n when %s', async (_label, warmResult) => {
    existsSyncMock.mockReturnValue(true)
    const dir = makeTempDir()
    mockOsascriptOnce(warmResult)
    mockOpenOnce('ok')

    const result = await openInGhostty(dir)

    expect(result).toEqual({ ok: true, message: dir })
    // -n forces a genuinely separate instance -- deliberately never passed
    // here, since a failed liveness check doesn't mean Ghostty isn't
    // actually running. See launchOrActivateGhostty's comment in ghostty.ts.
    const openArgs = execaMock.mock.calls[1]
    expect(openArgs).toEqual([
      'open',
      ['-a', 'Ghostty.app', '--args', `--working-directory=${dir}`],
      expect.any(Object),
    ])
  })

  test('returns the launch error when both the warm and cold paths fail', async () => {
    existsSyncMock.mockReturnValue(true)
    mockOsascriptOnce(new Error('osascript timed out'))
    mockOpenOnce(new Error('spawn open ENOENT'))

    const result = await openInGhostty(makeTempDir())

    expect(result).toEqual({ ok: false, message: 'spawn open ENOENT' })
  })
})

describe('openRemoteInGhostty', () => {
  test('rejects an unsafe alias/path combination without touching execa', async () => {
    const result = await openRemoteInGhostty('bad alias', '/srv/repo')
    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(execaMock).not.toHaveBeenCalled()
  })

  test('reuses a running instance with an SSH command configuration', async () => {
    existsSyncMock.mockReturnValue(true)
    mockOsascriptOnce({ stdout: 'opened' })

    const result = await openRemoteInGhostty('prod', '/srv/repo')

    expect(result).toEqual({ ok: true, message: '/srv/repo' })
    expect(execaMock).toHaveBeenCalledTimes(1)
    const osascriptArgs = execaMock.mock.calls[0]
    expect(osascriptArgs[0]).toBe('/usr/bin/osascript')
    const argv = osascriptArgs[1] as string[]
    expect(argv).toEqual([
      '-e',
      expect.stringContaining('command:commandText'),
      expect.stringContaining("'ssh' '-tt' '--' 'prod'"),
    ])
    expect(argv[1]).not.toContain('input text')
    expect(argv[1]).not.toContain('send key')
    expect(argv[2]).not.toMatch(/\n$/)
  })

  test('falls back to launching with -e ssh ... and without -n', async () => {
    existsSyncMock.mockReturnValue(true)
    mockOsascriptOnce({ stdout: 'not-running' })
    mockOpenOnce('ok')

    const result = await openRemoteInGhostty('prod', '/srv/repo')

    expect(result).toEqual({ ok: true, message: '/srv/repo' })
    const openArgs = execaMock.mock.calls[1][1] as string[]
    expect(openArgs[0]).toBe('-a')
    expect(openArgs).not.toContain('-n')
    expect(openArgs).toEqual(expect.arrayContaining(['-e', 'ssh']))
  })
})
