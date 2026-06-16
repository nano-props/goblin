import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  testTmpdir = path.join(realTmpdir(), `clipboard-bridge-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
  await mkdir(testTmpdir, { recursive: true })
  vi.spyOn(os, 'tmpdir').mockReturnValue(testTmpdir)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(testTmpdir, { recursive: true, force: true }).catch(() => {})
})

describe('saveClipboardBinaryFiles', () => {
  test('writes blobs to the per-process temp dir with timestamped names', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-bridge.ts')
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
    expect(path.basename(paths[0]).endsWith('-0-shot.png')).toBe(true)
    expect(path.basename(paths[1]).endsWith('-1-doc.pdf')).toBe(true)
    expect(paths[0]).toContain(`goblin-clipboard-${process.pid}`)
    expect(await readFile(paths[0], 'utf8')).toBe('alpha')
    expect(await readFile(paths[1], 'utf8')).toBe('beta')
  })

  test('returns empty array for empty input without creating the temp dir', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-bridge.ts')
    const paths = await saveClipboardBinaryFiles([])
    expect(paths).toEqual([])
    const entries = await readdir(testTmpdir)
    expect(entries.filter((e) => e.startsWith('goblin-clipboard-'))).toHaveLength(0)
  })

  test('rejects payloads exceeding PASTE_FILE_MAX_BYTES', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-bridge.ts')
    const oversized = new ArrayBuffer(PASTE_FILE_MAX_BYTES + 1)
    await expect(saveClipboardBinaryFiles([{ name: 'big.bin', bytes: oversized }])).rejects.toThrow(/exceeds/)
  })

  test('sanitises path-separator characters in the supplied name', async () => {
    const { saveClipboardBinaryFiles } = await import('#/main/clipboard-bridge.ts')
    const paths = await saveClipboardBinaryFiles([
      { name: '../escape/attempt.png', bytes: new ArrayBuffer(4) },
    ])
    expect(paths[0]).not.toContain('../')
    // Anchor the literal `.png` extension — see comment above on why
    // a bare `.png$` regex is not enough to catch the sanitiser
    // regression. We split the basename into literal segments so a
    // regex metacharacter cannot quietly compensate for a bad
    // replacement. Also assert the exact `attempt.png` substring
    // survives intact.
    const basename = path.basename(paths[0])
    expect(basename.includes('-0-attempt.png')).toBe(true)
    expect(basename.endsWith('-0-attempt.png')).toBe(true)
  })
})

describe('pruneStaleClipboardTempDirs', () => {
  test('removes goblin-clipboard-* dirs left by previous runs but preserves the current one', async () => {
    const { pruneStaleClipboardTempDirs, saveClipboardBinaryFiles } = await import('#/main/clipboard-bridge.ts')
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
    const { pruneStaleClipboardTempDirs } = await import('#/main/clipboard-bridge.ts')
    await mkdir(path.join(testTmpdir, 'someone-else'), { recursive: true })
    await pruneStaleClipboardTempDirs()
    const entries = await readdir(testTmpdir)
    expect(entries).toContain('someone-else')
  })
})

describe('wireClipboardBridgeIpc', () => {
  test('registers the handler and triggers a startup prune', async () => {
    const stale = path.join(testTmpdir, 'goblin-clipboard-99999')
    await mkdir(stale, { recursive: true })
    const { wireClipboardBridgeIpc } = await import('#/main/clipboard-bridge.ts')
    wireClipboardBridgeIpc()
    // pruneStaleClipboardTempDirs is fire-and-forget; await a microtask flush
    await new Promise((r) => setTimeout(r, 10))
    const entries = await readdir(testTmpdir)
    expect(entries).not.toContain('goblin-clipboard-99999')
    expect(ipcHandlers.has('goblin:clipboard-save-files')).toBe(true)
  })

  test('handler rejects untrusted senders by returning []', async () => {
    isTrustedIpcEventMock.mockReturnValue(false)
    const { wireClipboardBridgeIpc } = await import('#/main/clipboard-bridge.ts')
    wireClipboardBridgeIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const result = await handler(
      {},
      [{ name: 'a.txt', bytes: new ArrayBuffer(1) }],
    )
    expect(result).toEqual([])
  })

  test('handler returns [] on malformed payload shape', async () => {
    const { wireClipboardBridgeIpc } = await import('#/main/clipboard-bridge.ts')
    wireClipboardBridgeIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    expect(await handler({}, 'not an array')).toEqual([])
    expect(await handler({}, [{ name: 5, bytes: new ArrayBuffer(1) }])).toEqual([])
    expect(await handler({}, [{ name: 'ok', bytes: 'not-an-ArrayBuffer' }])).toEqual([])
  })

  test('handler returns absolute paths for a well-formed payload', async () => {
    const { wireClipboardBridgeIpc } = await import('#/main/clipboard-bridge.ts')
    wireClipboardBridgeIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const result = await handler(
      {},
      [{ name: 'a.txt', bytes: new TextEncoder().encode('hi').buffer as ArrayBuffer }],
    )
    expect(Array.isArray(result)).toBe(true)
    expect((result as string[])[0]).toContain(path.join(testTmpdir, `goblin-clipboard-${process.pid}`))
  })

  test('handler swallows write errors to []', async () => {
    const { wireClipboardBridgeIpc } = await import('#/main/clipboard-bridge.ts')
    wireClipboardBridgeIpc()
    const handler = ipcHandlers.get('goblin:clipboard-save-files')!
    const oversized = new ArrayBuffer(PASTE_FILE_MAX_BYTES + 1)
    const result = await handler({}, [{ name: 'big.bin', bytes: oversized }])
    expect(result).toEqual([])
  })
})
