import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    expect(path.basename(paths[0]).endsWith('-0-shot.png')).toBe(true)
    expect(await readFile(paths[0])).toEqual(Buffer.from([1, 2, 3]))
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
    expect(path.basename(paths[0]).endsWith('-0-attempt.bin')).toBe(true)
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
    expect(path.basename(paths[0]).endsWith('-0-name_tail.bin')).toBe(true)
  })

  test('falls back to "clipboard.bin" for empty file names', async () => {
    const { saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
    const file = new File([new Uint8Array([0])], '')
    const { paths } = await saveClipboardFiles([file])
    expect(path.basename(paths[0])).toMatch(/-0-clipboard\.bin$/)
  })
})

describe('pruneStaleClipboardTempDirs', () => {
  test('removes clipboard-tmp-* dirs from previous runs but preserves the current one', async () => {
    const { pruneStaleClipboardTempDirs, saveClipboardFiles } = await import('#/server/modules/clipboard-write-paths.ts')
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
