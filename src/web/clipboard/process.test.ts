import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

const mocks = vi.hoisted(() => ({
  resolvePastedFiles: vi.fn(),
}))

vi.mock('#/web/clipboard/resolver.ts', () => ({
  resolvePastedFiles: mocks.resolvePastedFiles,
}))

describe('shouldPreferFilesOverText', () => {
  test('no files → never prefer files', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    expect(shouldPreferFilesOverText('hello', false)).toBe(false)
    expect(shouldPreferFilesOverText('', false)).toBe(false)
    expect(shouldPreferFilesOverText('file:///a', false)).toBe(false)
  })

  test('files + empty text → prefer files', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    expect(shouldPreferFilesOverText('', true)).toBe(true)
  })

  test('files + URI-list text → prefer files (Linux file copy)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    expect(shouldPreferFilesOverText('file:///home/user/foo.png', true)).toBe(true)
    expect(shouldPreferFilesOverText('file:///a\nfile:///b', true)).toBe(true)
  })

  test('files + single-line non-URI text → prefer files (Windows file copy)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    expect(shouldPreferFilesOverText('C:\\Users\\foo\\bar.png', true)).toBe(true)
    expect(shouldPreferFilesOverText('/home/user/foo.png', true)).toBe(true)
  })

  test('files + multi-line non-URI text → prefer TEXT (Excel / tabular data)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    const tsv = 'Header1\tHeader2\nValue1\tValue2'
    expect(shouldPreferFilesOverText(tsv, true)).toBe(false)
  })

  test('files + single-row TSV (tab, single line) → prefer TEXT (single-row Excel case, Issue 1 fix)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // The previously-misclassified case: a single Excel row copied
    // produces one line of TSV with tabs. The tab character is the
    // load-bearing signal — not "multi-line".
    const tsv = 'Alice\t30\tNYC'
    expect(shouldPreferFilesOverText(tsv, true)).toBe(false)
  })

  test('files + multi-line absolute paths (no tabs, no URI) → prefer FILES (Windows multi-file defensive)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // Defensive coverage: if some platform produces newline-separated
    // absolute paths in text/plain without a URI scheme (no known
    // platform confirmed to do this, but Windows Explorer behaviour
    // for multi-file copy is uncertain), route to files so the
    // resolver shell-quotes them rather than handing raw text to xterm.
    expect(shouldPreferFilesOverText('C:\\a\\b.png\nC:\\c\\d.png', true)).toBe(true)
    expect(shouldPreferFilesOverText('/home/a\n/home/b', true)).toBe(true)
  })

  test('files + multi-line non-path-like text → prefer TEXT (OCR / multi-line prose)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // OCR output alongside an image: the text is real data, xterm
    // should handle it. None of the lines look like paths.
    const ocr = 'greeting from the image\nline two\nline three'
    expect(shouldPreferFilesOverText(ocr, true)).toBe(false)
  })

  test('files + single-line non-URI non-path text → prefer TEXT (Issue 1 fix: single-cell Excel)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // Regression for Issue 1: a single-cell Excel copy of a formatted
    // value (e.g. currency-formatted number, formatted date) attaches
    // a thumbnail blob while emitting plain text in text/plain — no
    // tab, no newline. The old rule routed this to the file branch
    // and wrote the thumbnail's path to PTY. The new rule requires
    // the single-line text to actually look like an absolute path
    // before preferring files.
    expect(shouldPreferFilesOverText('42', true)).toBe(false)
    expect(shouldPreferFilesOverText('Hello', true)).toBe(false)
    expect(shouldPreferFilesOverText('2024-01-15', true)).toBe(false)
    expect(shouldPreferFilesOverText('a single line', true)).toBe(false)
  })

  test('files + single-line URL → prefer TEXT (Issue 2 fix: not a path)', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // A URL pasted from a browser alongside an image blob is text
    // the user wants to see, not a filesystem path.
    expect(shouldPreferFilesOverText('https://example.com/foo', true)).toBe(false)
    expect(shouldPreferFilesOverText('mailto:user@example.com', true)).toBe(false)
  })

  test('files + single-line POSIX absolute path → prefer files', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    // Defensive coverage: a hypothetical platform that emits a bare
    // POSIX absolute path in text/plain (no URI scheme) routes to
    // files so the resolver can shell-quote it.
    expect(shouldPreferFilesOverText('/home/user/file.png', true)).toBe(true)
  })

  test('files + absolute path with trailing newline → prefer files', async () => {
    const { shouldPreferFilesOverText } = await import('#/web/clipboard/process.ts')
    expect(shouldPreferFilesOverText('/home/user/file.png\n', true)).toBe(true)
    expect(shouldPreferFilesOverText('C:\\Users\\foo\\bar.png\r\n', true)).toBe(true)
  })
})

describe('previewPaste', () => {
  test('empty text + empty files → no-op', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    expect(previewPaste({ text: '', files: [] })).toEqual({ kind: 'no-op' })
  })

  test('text only (single line) → text', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    expect(previewPaste({ text: 'hello', files: [] })).toEqual({ kind: 'text', text: 'hello' })
  })

  test('text only (multi-line TSV) → text', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const tsv = 'a\tb\nc\td'
    expect(previewPaste({ text: tsv, files: [] })).toEqual({ kind: 'text', text: tsv })
  })

  test('files only (no text) → files', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: '', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is URI list → files (Linux case)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'file:///home/user/a.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is single-line non-URI → files (Windows case)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'C:\\Users\\a.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is multi-line non-URI → TEXT (Excel case)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'thumbnail.png')
    const tsv = 'Header1\tHeader2\nValue1\tValue2'
    // The thumbnail is dropped — text wins.
    expect(previewPaste({ text: tsv, files: [f] })).toEqual({ kind: 'text', text: tsv })
  })

  test('text + files where text is single-row TSV → TEXT (single-row Excel case)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // Regression for Issue 1: a single Excel row used to be
    // misclassified as "single-line non-URI → files" because the
    // matrix keyed off "is multi-line" rather than the tab itself.
    const f = new File([new Uint8Array([1])], 'thumbnail.png')
    const tsv = 'Alice\t30\tNYC'
    expect(previewPaste({ text: tsv, files: [f] })).toEqual({ kind: 'text', text: tsv })
  })

  test('text + files where text is multi-line absolute paths → files (Windows multi-file defensive)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // Defensive coverage: see shouldPreferFilesOverText. The
    // thumbnail/extra file is dropped; the resolver receives the
    // single File and produces a shell-quoted path for it.
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'C:\\a\\b.png\nC:\\c\\d.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is single-cell value (no tab) → TEXT (single-cell Excel case)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // Regression for Issue 1: single-cell Excel with formatting
    // (currency, dates, etc.) attaches a thumbnail. The text is
    // a plain value with no tabs — old rule routed to files, new
    // rule routes to text because the value doesn't look like a path.
    const f = new File([new Uint8Array([1])], 'thumbnail.png', { type: 'image/png' })
    expect(previewPaste({ text: '42', files: [f] })).toEqual({ kind: 'text', text: '42' })
    expect(previewPaste({ text: '2024-01-15', files: [f] })).toEqual({ kind: 'text', text: '2024-01-15' })
  })

  test('text + files where text is single-line URL → TEXT (not a path)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // Regression for Issue 2: a URL pasted from a browser alongside
    // an image blob is text the user wants, not a path to resolve.
    const f = new File([new Uint8Array([1])], 'image.png')
    expect(previewPaste({ text: 'https://example.com/foo', files: [f] })).toEqual({
      kind: 'text',
      text: 'https://example.com/foo',
    })
  })

  test('text + files where text is single-line POSIX absolute path → files', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // Bare POSIX absolute path (no URI scheme) routes to files for
    // shell-quoting via the resolver.
    const f = new File([new Uint8Array([1])], 'file.png')
    expect(previewPaste({ text: '/home/user/file.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is a single absolute path with trailing newline → files', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'file.png')
    expect(previewPaste({ text: '/home/user/file.png\n', files: [f] })).toEqual({ kind: 'files' })
  })

  test('any oversized file in files branch → too-large', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    const ok = new File([new Uint8Array([1])], 'ok.png')
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    expect(previewPaste({ text: '', files: [ok, huge] })).toEqual({ kind: 'too-large' })
  })

  test('text-only oversized is not gated (text has no size cap at this layer)', async () => {
    const { previewPaste } = await import('#/web/clipboard/process.ts')
    // The text branch never goes through the resolver and has no
    // size cap; xterm.js itself handles paste payload size limits.
    // We assert the current behaviour so any future cap shows up as
    // a test failure here.
    const bigText = 'x'.repeat(100 * 1024 * 1024)
    expect(previewPaste({ text: bigText, files: [] }).kind).toBe('text')
  })
})

describe('processDrop', () => {
  beforeEach(() => {
    mocks.resolvePastedFiles.mockReset()
  })

  test('returns no-op for empty input', async () => {
    const { processDrop } = await import('#/web/clipboard/process.ts')
    await expect(processDrop({ files: [] })).resolves.toEqual({ kind: 'no-op' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('returns too-large for any file over the cap', async () => {
    const { processDrop } = await import('#/web/clipboard/process.ts')
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    await expect(processDrop({ files: [huge] })).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('delegates to the resolver for OK-sized files', async () => {
    mocks.resolvePastedFiles.mockResolvedValue({ paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 })
    const { processDrop } = await import('#/web/clipboard/process.ts')
    const a = new File([new Uint8Array([1])], 'a')
    await expect(processDrop({ files: [a] })).resolves.toEqual({
      kind: 'files',
      resolution: { paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 },
    })
    expect(mocks.resolvePastedFiles).toHaveBeenCalledWith([a])
  })
})
