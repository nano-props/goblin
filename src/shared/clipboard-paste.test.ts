import { describe, expect, test } from 'vitest'
import { isTerminalPastePathSafe, looksLikeAbsolutePathList, looksLikeUriList } from '#/shared/clipboard-paste.ts'

describe('isTerminalPastePathSafe', () => {
  test('allows ordinary shell metacharacters that shell quoting handles', () => {
    expect(isTerminalPastePathSafe('/tmp/$HOME/notes')).toBe(true)
    expect(isTerminalPastePathSafe("/tmp/it's here.txt")).toBe(true)
    expect(isTerminalPastePathSafe('/tmp/[draft]*.md')).toBe(true)
  })

  test.each([
    ['NUL', '\x00'],
    ['BEL', '\x07'],
    ['TAB', '\x09'],
    ['LF', '\x0a'],
    ['CR', '\x0d'],
    ['ESC', '\x1b'],
    ['DEL', '\x7f'],
    ['CSI', '\x9b'],
  ])('rejects %s control bytes', (_label, control) => {
    expect(isTerminalPastePathSafe(`/tmp/a${control}b`)).toBe(false)
  })
})

describe('looksLikeUriList', () => {
  test('returns false for an empty string', () => {
    expect(looksLikeUriList('')).toBe(false)
  })

  test('returns false for whitespace only', () => {
    expect(looksLikeUriList('   \n\n\t')).toBe(false)
  })

  test('returns false for plain prose', () => {
    expect(looksLikeUriList('hello world')).toBe(false)
  })

  test('returns false for Excel-style TSV (multi-line, no file:// prefix)', () => {
    // The defining Excel scenario: a row of header cells and a row of
    // values, tab-separated. None of the lines start with file://.
    const tsv = 'Header1\tHeader2\tHeader3\nValue1\tValue2\tValue3'
    expect(looksLikeUriList(tsv)).toBe(false)
  })

  test('returns true for a single file:// URI', () => {
    expect(looksLikeUriList('file:///home/user/foo.png')).toBe(true)
  })

  test('returns true for multiple file:// URIs (one per line)', () => {
    const list = ['file:///home/user/foo.png', 'file:///home/user/bar.pdf'].join('\n')
    expect(looksLikeUriList(list)).toBe(true)
  })

  test('returns true when file:// URIs are mixed with RFC 2483 comments', () => {
    const list = ['# copied from Nautilus', 'file:///home/user/foo.png', '# trailing comment', ''].join('\n')
    expect(looksLikeUriList(list)).toBe(true)
  })

  test('returns true with CRLF line endings (Windows-style)', () => {
    expect(looksLikeUriList('file:///a\r\nfile:///b\r\n')).toBe(true)
  })

  test('returns true with surrounding whitespace on each line', () => {
    expect(looksLikeUriList('  file:///a  \n  file:///b  ')).toBe(true)
  })

  test('returns false when at least one significant line is not a file:// URI', () => {
    // The typical Linux file manager never produces this shape; if a
    // single non-URI line appears, the text is real data, not a URI
    // list. We must NOT classify it as a URI list.
    const mixed = ['file:///a', 'not a uri', 'file:///b'].join('\n')
    expect(looksLikeUriList(mixed)).toBe(false)
  })

  test('returns false when only comments are present (no actual URIs)', () => {
    expect(looksLikeUriList('# just a comment\n# another one')).toBe(false)
  })
})

describe('looksLikeAbsolutePathList', () => {
  test('returns false for empty / single line', () => {
    expect(looksLikeAbsolutePathList('')).toBe(false)
    // Single-line input is handled by the "single-line + files → files"
    // branch; this predicate is only consulted for multi-line text.
    expect(looksLikeAbsolutePathList('/single/path')).toBe(false)
    expect(looksLikeAbsolutePathList('C:\\Users\\foo\\bar.png')).toBe(false)
  })

  test('returns true for multiple POSIX absolute paths', () => {
    expect(looksLikeAbsolutePathList('/home/a\n/home/b')).toBe(true)
    expect(looksLikeAbsolutePathList('/home/a\r\n/home/b\r\n')).toBe(true)
  })

  test('returns true for multiple Windows drive-letter paths', () => {
    expect(looksLikeAbsolutePathList('C:\\a\\b\nC:\\c\\d')).toBe(true)
    expect(looksLikeAbsolutePathList('C:\\a\nD:\\b')).toBe(true)
  })

  test('returns true for Windows UNC paths', () => {
    expect(looksLikeAbsolutePathList('\\\\server\\share\\a\n\\\\server\\share\\b')).toBe(true)
  })

  test('returns false for non-file URIs (https, sftp, mailto)', () => {
    // Regression: the predicate previously matched any URI scheme
    // (https://, sftp://, etc.), which would silently drop multi-line
    // URL text from a webpage when paired with an image blob. The
    // shell can't resolve non-file URIs and the resolver doesn't know
    // how to convert them to filesystem paths — they must reach xterm
    // as text. `file://` URIs are caught separately by `looksLikeUriList`.
    expect(looksLikeAbsolutePathList('https://example.com/a\nhttps://example.com/b')).toBe(false)
    expect(looksLikeAbsolutePathList('sftp://a/b\nsftp://c/d')).toBe(false)
    expect(looksLikeAbsolutePathList('mailto:a@b.com\nmailto:c@d.com')).toBe(false)
  })

  test('returns false if any non-empty line is not path-like', () => {
    expect(looksLikeAbsolutePathList('/home/a\nnot a path')).toBe(false)
    expect(looksLikeAbsolutePathList('echo hello\nworld')).toBe(false)
    expect(looksLikeAbsolutePathList('C:\\a\\b\ngreeting\nC:\\c\\d')).toBe(false)
  })

  test('ignores blank lines between paths', () => {
    expect(looksLikeAbsolutePathList('/home/a\n\n/home/b')).toBe(true)
    expect(looksLikeAbsolutePathList('/home/a\n   \n/home/b')).toBe(true)
  })
})
