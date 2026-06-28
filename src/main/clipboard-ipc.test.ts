import { mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
const isTrustedIpcEventMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler)
    }),
  },
}))

vi.mock('#/main/ipc/trusted-webcontents.ts', () => ({
  isTrustedIpcEvent: isTrustedIpcEventMock,
}))

const realTmpdir = os.tmpdir
let testTmpdir = ''

beforeEach(async () => {
  ipcHandlers.clear()
  vi.clearAllMocks()
  isTrustedIpcEventMock.mockReturnValue(true)
  // Per-test tmpdir keeps sweep tests isolated from anything else under /tmp.
  testTmpdir = path.join(realTmpdir(), `clipboard-ipc-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
  await mkdir(testTmpdir, { recursive: true })
  vi.spyOn(os, 'tmpdir').mockReturnValue(testTmpdir)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(testTmpdir, { recursive: true, force: true }).catch(() => {})
})

describe('saveClipboardBinaryFiles', () => {
  test('writes blobs to the per-process temp dir with timestamped names', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const paths = await saveClipboardBinaryFiles([
      { name: 'shot.png', bytes: new TextEncoder().encode('alpha').buffer as ArrayBuffer },
      { name: 'doc.pdf', bytes: new TextEncoder().encode('beta').buffer as ArrayBuffer },
    ])
    expect(paths).toHaveLength(2)
    // Use literal basename assertions, not regex — `.` is a regex
    // metacharacter and a too-wide character class in `sanitizeBaseName`
    // would silently turn `shot.png` into `shot_png` while a
    // `/-0-shot\.png$/` regex would still match (the `.` was a
    // wildcard). Split into literal-segment assertions so the
    // regression re-fails loudly.
    expect(path.basename(paths[0]).endsWith('shot.png')).toBe(true)
    expect(path.basename(paths[1]).endsWith('doc.pdf')).toBe(true)
    expect(paths[0]).toContain(`goblin-clipboard-${process.pid}`)
    expect(await readFile(paths[0], 'utf8')).toBe('alpha')
    expect(await readFile(paths[1], 'utf8')).toBe('beta')
  })

  test('two single-file pastes in the same millisecond produce distinct filenames', async () => {
    // Regression test for the timestamp/index collision. The
    // previous format `<ISO>-<index>-<name>` was unique per
    // request (because index 0 vs 1 differed inside a single
    // multi-file request) but collided across two *different*
    // single-file requests that landed in the same millisecond —
    // the second `writeFile` silently overwrote the first. The
    // new format inserts a process-level counter between index
    // and name; this test pins that the counter is part of the
    // filename and is unique per call.
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const a = await saveClipboardBinaryFiles([{ name: 'first.bin', bytes: new ArrayBuffer(1) }])
    const b = await saveClipboardBinaryFiles([{ name: 'first.bin', bytes: new ArrayBuffer(1) }])
    expect(a[0]).not.toBe(b[0])
    // The counter is a non-empty segment between `-<index>-` and
    // `-<name>`. Assert the literal basename shape, not a regex,
    // so a future refactor that drops the counter re-fails.
    expect(path.basename(a[0])).toMatch(/^.+-0-\d+-first\.bin$/)
    expect(path.basename(b[0])).toMatch(/^.+-0-\d+-first\.bin$/)
  })

  test('returns empty array for empty input without creating the temp dir', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const paths = await saveClipboardBinaryFiles([])
    expect(paths).toEqual([])
    const entries = await readdir(testTmpdir)
    expect(entries.filter((e) => e.startsWith('goblin-clipboard-'))).toHaveLength(0)
  })

  test('rejects payloads exceeding PASTE_FILE_MAX_BYTES', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const oversized = new ArrayBuffer(PASTE_FILE_MAX_BYTES + 1)
    await expect(saveClipboardBinaryFiles([{ name: 'big.bin', bytes: oversized }])).rejects.toThrow(/exceeds/)
  })

  test('sanitises path-separator characters in the supplied name', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const paths = await saveClipboardBinaryFiles([{ name: '../escape/attempt.png', bytes: new ArrayBuffer(4) }])
    expect(paths[0]).not.toContain('../')
    // Anchor the literal `.png` extension — see comment above on why
    // a bare `.png$` regex is not enough to catch the sanitiser
    // regression. We split the basename into literal segments so a
    // regex metacharacter cannot quietly compensate for a bad
    // replacement. Also assert the exact `attempt.png` substring
    // survives intact.
    const basename = path.basename(paths[0])
    expect(basename.includes('attempt.png')).toBe(true)
    expect(basename.endsWith('attempt.png')).toBe(true)
  })

  test('strips C1 control characters (0x7F-0x9F) from file names', async () => {
    // The C1 control range (U+007F DELETE through U+009F) is also
    // reserved on Windows NTFS, and would reject the file at
    // later-write time. The sanitiser covers the C0 (\x00-\x1F) and
    // C1 (\x7F-\x9F) ranges together. This test exercises an
    // out-of-band character in the C1 range to lock the contract
    // — if a future refactor narrows the character class to
    // \x00-\x1F, this re-fails loudly.
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const c1Char = String.fromCharCode(0x90) // U+0090, control char
    const name = `name${c1Char}tail.bin`
    const paths = await saveClipboardBinaryFiles([{ name, bytes: new ArrayBuffer(1) }])
    const basename = path.basename(paths[0])
    expect(basename).not.toContain(c1Char)
    expect(basename.endsWith('name_tail.bin')).toBe(true)
  })

  test('prefixes Windows reserved file stems after sanitising', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    const paths = await saveClipboardBinaryFiles([
      { name: 'CON.png', bytes: new ArrayBuffer(1) },
      { name: 'lpt9.txt', bytes: new ArrayBuffer(1) },
    ])
    expect(path.basename(paths[0]).endsWith('_CON.png')).toBe(true)
    expect(path.basename(paths[1]).endsWith('_lpt9.txt')).toBe(true)
  })
})

describe('pruneStaleClipboardTempDirs', () => {
  test('removes goblin-clipboard-* dirs left by previous runs but preserves the current one', async () => {
    const { pruneStaleClipboardTempDirs, saveClipboardBinaryFiles } = await import('#/main/clipboard-ipc.ts')
    // Stale leftovers
    const stale = path.join(testTmpdir, 'goblin-clipboard-99999')
    await mkdir(stale, { recursive: true })
    await writeFile(path.join(stale, 'leftover.bin'), 'x')
    // Our own current-run dir, created by saving a file
    await saveClipboardBinaryFiles([{ name: 'live.bin', bytes: new ArrayBuffer(1) }])
    const currentDir = path.join(testTmpdir, `goblin-clipboard-${process.pid}`)
    await pruneStaleClipboardTempDirs()
    const entries = await readdir(testTmpdir)
    expect(entries).toContain(path.basename(currentDir))
    expect(entries).not.toContain('goblin-clipboard-99999')
  })

  test('ignores unrelated entries in the temp dir', async () => {
    const { pruneStaleClipboardTempDirs } = await import('#/main/clipboard-ipc.ts')
    await mkdir(path.join(testTmpdir, 'someone-else'), { recursive: true })
    await pruneStaleClipboardTempDirs()
    const entries = await readdir(testTmpdir)
    expect(entries).toContain('someone-else')
  })
})

describe('pruneExpiredClipboardTempFiles', () => {
  test('removes expired files from the current process temp dir but preserves fresh files', async () => {
    const { pruneExpiredClipboardTempFiles } = await import('#/main/clipboard-ipc.ts')
    const currentDir = path.join(testTmpdir, `goblin-clipboard-${process.pid}`)
    await mkdir(currentDir, { recursive: true })
    const oldFile = path.join(currentDir, 'old.bin')
    const freshFile = path.join(currentDir, 'fresh.bin')
    await writeFile(oldFile, 'old')
    await writeFile(freshFile, 'fresh')
    const now = Date.now()
    const oldDate = new Date(now - 10_000)
    const freshDate = new Date(now - 1_000)
    await utimes(oldFile, oldDate, oldDate)
    await utimes(freshFile, freshDate, freshDate)

    await pruneExpiredClipboardTempFiles(now, 5_000)

    const entries = await readdir(currentDir)
    expect(entries).not.toContain('old.bin')
    expect(entries).toContain('fresh.bin')
  })

  test('does not throw when the current temp dir is missing', async () => {
    const { pruneExpiredClipboardTempFiles } = await import('#/main/clipboard-ipc.ts')
    await expect(pruneExpiredClipboardTempFiles()).resolves.toBeUndefined()
  })

  test('handles empty dirs, subdirs, and stat failures without throwing', async () => {
    const { pruneExpiredClipboardTempFiles } = await import('#/main/clipboard-ipc.ts')
    const currentDir = path.join(testTmpdir, `goblin-clipboard-${process.pid}`)
    await mkdir(currentDir, { recursive: true })
    await expect(pruneExpiredClipboardTempFiles(Date.now(), 0)).resolves.toBeUndefined()
    await mkdir(path.join(currentDir, 'nested'), { recursive: true })
    await symlink(path.join(currentDir, 'missing.bin'), path.join(currentDir, 'broken-link'))

    await expect(pruneExpiredClipboardTempFiles(Date.now(), 0)).resolves.toBeUndefined()

    const entries = await readdir(currentDir)
    expect(entries).toContain('nested')
    expect(entries).toContain('broken-link')
  })
})

describe('wireClipboardIpc', () => {
  test('registers the handler and triggers a startup prune', async () => {
    const stale = path.join(testTmpdir, 'goblin-clipboard-99999')
    await mkdir(stale, { recursive: true })
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    // pruneStaleClipboardTempDirs is fire-and-forget; await a microtask flush
    await new Promise((r) => setTimeout(r, 10))
    const entries = await readdir(testTmpdir)
    expect(entries).not.toContain('goblin-clipboard-99999')
    expect(ipcHandlers.has('goblin:clipboard-save-files')).toBe(true)
  })

  test('handler rejects untrusted senders by returning []', async () => {
    isTrustedIpcEventMock.mockReturnValue(false)
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const result = await handler({}, [{ name: 'a.txt', bytes: new ArrayBuffer(1) }])
    expect(result).toEqual([])
  })

  test('handler returns [] on malformed payload shape', async () => {
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    expect(await handler({}, 'not an array')).toEqual([])
    expect(await handler({}, [{ name: 5, bytes: new ArrayBuffer(1) }])).toEqual([])
    expect(await handler({}, [{ name: 'ok', bytes: 'not-an-ArrayBuffer' }])).toEqual([])
  })

  test('handler returns absolute paths for a well-formed payload', async () => {
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const result = await handler({}, [{ name: 'a.txt', bytes: new TextEncoder().encode('hi').buffer as ArrayBuffer }])
    expect(Array.isArray(result)).toBe(true)
    expect((result as string[])[0]).toContain(path.join(testTmpdir, `goblin-clipboard-${process.pid}`))
  })

  test('handler swallows write errors to []', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const oversized = new ArrayBuffer(PASTE_FILE_MAX_BYTES + 1)
    const result = await handler({}, [{ name: 'big.bin', bytes: oversized }])
    expect(result).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      '[clipboard-ipc] goblin:clipboard-save-files failed',
      expect.objectContaining({ message: `Clipboard payload exceeds ${PASTE_FILE_MAX_BYTES} bytes` }),
    )
  })

  test('clears any prior periodic-prune interval on re-entry', async () => {
    // Regression for the previous implementation that called
    // `setInterval` unconditionally on every wire-up. The test
    // harness re-enters `wireClipboardIpc` (each test that
    // touches the handler calls it again), and without the
    // clearInterval guard each call stacked a 1 h timer that no one
    // ever cleared. We assert that the second call invokes
    // `clearInterval` exactly once with a non-zero handle, leaving
    // the most recent timer in place.
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { wireClipboardIpc } = await import('#/main/clipboard-ipc.ts')
    wireClipboardIpc()
    const firstCallCount = clearIntervalSpy.mock.calls.length
    wireClipboardIpc()
    const newCalls = clearIntervalSpy.mock.calls.slice(firstCallCount)
    expect(newCalls).toHaveLength(1)
    const cleared = newCalls[0]?.[0]
    expect(cleared).toBeDefined()
    expect(cleared).not.toBe(0)
    clearIntervalSpy.mockRestore()
  })
})
