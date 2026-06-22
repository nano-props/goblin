import { mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

let dataDir = ''

beforeEach(async () => {
  dataDir = path.join(os.tmpdir(), `clipboard-write-paths-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
  await mkdir(dataDir, { recursive: true })
  vi.stubEnv('GOBLIN_SERVER_DATA_DIR', dataDir)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

describe('saveClipboardFiles', () => {
  test('writes uploaded files under <serverDataDir>/clipboard-tmp-<pid>/ with timestamped names', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const { paths } = await saveClipboardFiles([file])
    expect(paths).toHaveLength(1)
    const writtenDir = path.dirname(paths[0])
    expect(path.basename(writtenDir)).toBe(`clipboard-tmp-${process.pid}`)
    expect(path.dirname(writtenDir)).toBe(dataDir)
    // Literal-segment basename assertion — the regex `\.png$` form
    // would have silently passed if `sanitizeBaseName` turned
    // `shot.png` into `shot_png` (the `.` is a regex wildcard). See
    // the same fix in main/clipboard-bridge.test.ts for context.
    expect(path.basename(paths[0]).endsWith('shot.png')).toBe(true)
    expect(await readFile(paths[0])).toEqual(Buffer.from([1, 2, 3]))
  })

  test('two single-file pastes in the same millisecond produce distinct filenames', async () => {
    // Mirrors the main-process regression test. Locks the
    // process-level counter into the filename so the
    // `<ISO>-<index>-<name>` collision across paste events
    // can't return.
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const a = await saveClipboardFiles([new File([new Uint8Array([1])], 'first.bin')])
    const b = await saveClipboardFiles([new File([new Uint8Array([1])], 'first.bin')])
    expect(a.paths[0]).not.toBe(b.paths[0])
    expect(path.basename(a.paths[0])).toMatch(/^.+-0-\d+-first\.bin$/)
    expect(path.basename(b.paths[0])).toMatch(/^.+-0-\d+-first\.bin$/)
  })

  test('returns empty paths for empty input', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    expect(await saveClipboardFiles([])).toEqual({ paths: [] })
  })

  test('rejects when any single file exceeds PASTE_FILE_MAX_BYTES', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const big = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'big.bin')
    await expect(saveClipboardFiles([big])).rejects.toThrow(/exceeds/)
  })

  test('sanitises path-separator characters in the file name', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const file = new File([new Uint8Array([0])], '../escape/attempt.bin')
    const { paths } = await saveClipboardFiles([file])
    expect(paths[0]).not.toContain('../')
    // Literal substring assertion — the regex `\.bin$` form used to
    // silently pass even when the sanitiser replaced the dot with
    // `_`. See sibling fix in main/clipboard-bridge.test.ts.
    expect(path.basename(paths[0]).endsWith('attempt.bin')).toBe(true)
  })

  test('strips C1 control characters (0x7F-0x9F) from file names', async () => {
    // Mirrors the main-process test. Locks the contract that the
    // sanitiser covers the C0 (\x00-\x1F) and C1 (\x7F-\x9F) ranges
    // together — Windows NTFS treats both as reserved. If a future
    // refactor narrows the character class to \x00-\x1F, this
    // re-fails loudly.
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const c1Char = String.fromCharCode(0x90)
    const file = new File([new Uint8Array([0])], `name${c1Char}tail.bin`)
    const { paths } = await saveClipboardFiles([file])
    expect(paths[0]).not.toContain(c1Char)
    expect(path.basename(paths[0]).endsWith('name_tail.bin')).toBe(true)
  })

  test('falls back to "clipboard.bin" for empty file names', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const file = new File([new Uint8Array([0])], '')
    const { paths } = await saveClipboardFiles([file])
    // Filename is `<ISO>-0-<counter>-clipboard.bin`; the counter is
    // process-level so the exact value isn't pinned here.
    expect(path.basename(paths[0])).toMatch(/\d+-\d+-clipboard\.bin$/)
  })

  test('prefixes Windows reserved file stems after sanitising', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const { paths } = await saveClipboardFiles([
      new File([new Uint8Array([0])], 'AUX.png'),
      new File([new Uint8Array([0])], 'com1.txt'),
    ])
    expect(path.basename(paths[0]).endsWith('_AUX.png')).toBe(true)
    expect(path.basename(paths[1]).endsWith('_com1.txt')).toBe(true)
  })
})

describe('pruneStaleClipboardTempDirs', () => {
  test('removes clipboard-tmp-* dirs from previous runs but preserves the current one', async () => {
    const { pruneStaleClipboardTempDirs, saveClipboardFiles } =
      await import('#/server/modules/clipboard-write-paths.ts')
    const stale = path.join(dataDir, 'clipboard-tmp-99999')
    await mkdir(stale, { recursive: true })
    await writeFile(path.join(stale, 'leftover.bin'), 'x')
    // Create current-run dir
    await saveClipboardFiles([new File([new Uint8Array([0])], 'live.bin')])
    await pruneStaleClipboardTempDirs()
    const entries = await readdir(dataDir)
    expect(entries).toContain(`clipboard-tmp-${process.pid}`)
    expect(entries).not.toContain('clipboard-tmp-99999')
  })

  test('ignores unrelated entries', async () => {
    const { pruneStaleClipboardTempDirs } = await import('#/server/modules/clipboard-write-paths.ts')
    await mkdir(path.join(dataDir, 'someone-else'), { recursive: true })
    await pruneStaleClipboardTempDirs()
    const entries = await readdir(dataDir)
    expect(entries).toContain('someone-else')
  })

  test('does not throw if the data dir does not exist', async () => {
    vi.stubEnv('GOBLIN_SERVER_DATA_DIR', path.join(dataDir, 'never-existed'))
    const { pruneStaleClipboardTempDirs } = await import('#/server/modules/clipboard-write-paths.ts')
    await expect(pruneStaleClipboardTempDirs()).resolves.toBeUndefined()
  })
})

describe('pruneExpiredClipboardTempFiles', () => {
  test('removes expired files from the current server temp dir but preserves fresh files', async () => {
    const { clipboardTempDir, pruneExpiredClipboardTempFiles } =
      await import('#/server/modules/clipboard-write-paths.ts')
    const currentDir = clipboardTempDir()
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

  test('does not throw if the current server temp dir does not exist', async () => {
    const { pruneExpiredClipboardTempFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    await expect(pruneExpiredClipboardTempFiles()).resolves.toBeUndefined()
  })

  test('handles empty dirs, subdirs, and stat failures without throwing', async () => {
    const { clipboardTempDir, pruneExpiredClipboardTempFiles } =
      await import('#/server/modules/clipboard-write-paths.ts')
    const currentDir = clipboardTempDir()
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
