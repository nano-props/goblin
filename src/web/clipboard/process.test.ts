import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { previewPaste, processDrop } from '#/web/clipboard/process.ts'

const mocks = vi.hoisted(() => ({
  resolvePastedFiles: vi.fn(),
}))

vi.mock('#/web/clipboard/resolver.ts', () => ({
  resolvePastedFiles: mocks.resolvePastedFiles,
}))

describe('previewPaste', () => {
  test('empty text + empty files → no-op', () => {
    expect(previewPaste({ text: '', files: [] })).toEqual({ kind: 'no-op' })
  })

  test('text only (single line) → text', () => {
    expect(previewPaste({ text: 'hello', files: [] })).toEqual({ kind: 'text', text: 'hello' })
  })

  test('text only (multi-line TSV) → text', () => {
    const tsv = 'a\tb\nc\td'
    expect(previewPaste({ text: tsv, files: [] })).toEqual({ kind: 'text', text: tsv })
  })

  test('files only (no text) → files', () => {
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: '', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is URI list → files (Linux case)', () => {
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'file:///home/user/a.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is single-line non-URI → files (Windows case)', () => {
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'C:\\Users\\a.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is multi-line non-URI → TEXT (Excel case)', () => {
    const f = new File([new Uint8Array([1])], 'thumbnail.png')
    const tsv = 'Header1\tHeader2\nValue1\tValue2'
    // The thumbnail is dropped — text wins.
    expect(previewPaste({ text: tsv, files: [f] })).toEqual({ kind: 'text', text: tsv })
  })

  test('text + files where text is single-row TSV → TEXT (single-row Excel case)', () => {
    // Regression for Issue 1: a single Excel row used to be
    // misclassified as "single-line non-URI → files" because the
    // matrix keyed off "is multi-line" rather than the tab itself.
    const f = new File([new Uint8Array([1])], 'thumbnail.png')
    const tsv = 'Alice\t30\tNYC'
    expect(previewPaste({ text: tsv, files: [f] })).toEqual({ kind: 'text', text: tsv })
  })

  test('text + files where text is multi-line absolute paths → files (Windows multi-file defensive)', () => {
    // Defensive coverage: see shouldPreferFilesOverText. The
    // thumbnail/extra file is dropped; the resolver receives the
    // single File and produces a shell-quoted path for it.
    const f = new File([new Uint8Array([1])], 'a.png')
    expect(previewPaste({ text: 'C:\\a\\b.png\nC:\\c\\d.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is multi-line prose → text', () => {
    const file = new File([new Uint8Array([1])], 'scan.png')
    const text = 'greeting from the image\nline two\nline three'
    expect(previewPaste({ text, files: [file] })).toEqual({ kind: 'text', text })
  })

  test('text + files where text is single-cell value (no tab) → TEXT (single-cell Excel case)', () => {
    // Regression for Issue 1: single-cell Excel with formatting
    // (currency, dates, etc.) attaches a thumbnail. The text is
    // a plain value with no tabs — old rule routed to files, new
    // rule routes to text because the value doesn't look like a path.
    const f = new File([new Uint8Array([1])], 'thumbnail.png', { type: 'image/png' })
    expect(previewPaste({ text: '42', files: [f] })).toEqual({ kind: 'text', text: '42' })
    expect(previewPaste({ text: '2024-01-15', files: [f] })).toEqual({ kind: 'text', text: '2024-01-15' })
  })

  test('text + files where text is single-line URL → TEXT (not a path)', () => {
    // Regression for Issue 2: a URL pasted from a browser alongside
    // an image blob is text the user wants, not a path to resolve.
    const f = new File([new Uint8Array([1])], 'image.png')
    expect(previewPaste({ text: 'https://example.com/foo', files: [f] })).toEqual({
      kind: 'text',
      text: 'https://example.com/foo',
    })
  })

  test('text + files where text is single-line POSIX absolute path → files', () => {
    // Bare POSIX absolute path (no URI scheme) routes to files for
    // shell-quoting via the resolver.
    const f = new File([new Uint8Array([1])], 'file.png')
    expect(previewPaste({ text: '/home/user/file.png', files: [f] })).toEqual({ kind: 'files' })
  })

  test('text + files where text is a single absolute path with trailing newline → files', () => {
    const f = new File([new Uint8Array([1])], 'file.png')
    expect(previewPaste({ text: '/home/user/file.png\n', files: [f] })).toEqual({ kind: 'files' })
  })

  test('any oversized file in files branch → too-large', () => {
    const ok = new File([new Uint8Array([1])], 'ok.png')
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    expect(previewPaste({ text: '', files: [ok, huge] })).toEqual({ kind: 'too-large' })
  })

  test('text-only oversized is not gated (text has no size cap at this layer)', () => {
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
    await expect(processDrop({ files: [] })).resolves.toEqual({ kind: 'no-op' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('returns too-large for any file over the cap', async () => {
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    await expect(processDrop({ files: [huge] })).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('delegates to the resolver for OK-sized files', async () => {
    mocks.resolvePastedFiles.mockResolvedValue({ paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 })
    const a = new File([new Uint8Array([1])], 'a')
    await expect(processDrop({ files: [a] })).resolves.toEqual({
      kind: 'files',
      resolution: { paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 },
    })
    expect(mocks.resolvePastedFiles).toHaveBeenCalledWith([a])
  })
})
