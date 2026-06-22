import { describe, expect, test } from 'vitest'
import { MAX_TERMINAL_WRITE_CHARS, TERMINAL_WS_MESSAGE_LIMIT_BYTES } from '#/shared/terminal-validators.ts'
import { planTerminalPathWrite, shellEscapePath } from '#/web/clipboard/terminal-path-write.ts'

describe('shellEscapePath', () => {
  test('quotes simple paths so shell metacharacters cannot expand later', () => {
    expect(shellEscapePath('/tmp/a-b_1.txt')).toBe("'/tmp/a-b_1.txt'")
    expect(shellEscapePath('/tmp/$HOME/notes')).toBe("'/tmp/$HOME/notes'")
  })

  test('quotes spaces and embedded single quotes', () => {
    expect(shellEscapePath("/tmp/it's here.txt")).toBe("'/tmp/it'\\''s here.txt'")
  })
})

describe('planTerminalPathWrite', () => {
  test('returns a write plan for safe paths and preserves failed count', () => {
    expect(planTerminalPathWrite(['/tmp/a', '/tmp/with space'], { failedUnsafe: 0, failedBackend: 1 })).toEqual({
      kind: 'write',
      data: "'/tmp/a' '/tmp/with space'",
      failures: { failedUnsafe: 0, failedBackend: 1 },
    })
  })

  test('filters terminal control characters and reports them as failed', () => {
    expect(planTerminalPathWrite(['/tmp/ok', '/tmp/bad\u001bname'], { failedUnsafe: 0, failedBackend: 0 })).toEqual({
      kind: 'write',
      data: "'/tmp/ok'",
      failures: { failedUnsafe: 1, failedBackend: 0 },
    })
  })

  test('preserves caller-supplied backend failures while counting unsafe paths', () => {
    expect(planTerminalPathWrite(['/tmp/ok', '/tmp/bad\nname'], { failedUnsafe: 2, failedBackend: 3 })).toEqual({
      kind: 'write',
      data: "'/tmp/ok'",
      failures: { failedUnsafe: 3, failedBackend: 3 },
    })
  })

  test('returns none when every path is unsafe', () => {
    expect(planTerminalPathWrite(['/tmp/bad\nname'], { failedUnsafe: 0, failedBackend: 0 })).toEqual({
      kind: 'none',
      failures: { failedUnsafe: 1, failedBackend: 0 },
    })
  })

  test('returns too-long before building an oversized terminal write', () => {
    const hugePath = `/tmp/${'a'.repeat(MAX_TERMINAL_WRITE_CHARS)}`
    expect(planTerminalPathWrite([hugePath], { failedUnsafe: 0, failedBackend: 0 })).toEqual({ kind: 'too-long' })
  })

  test('returns too-long for many short paths that overflow the envelope together', () => {
    const paths = Array.from({ length: 100_000 }, (_, index) => `/tmp/file-${index}.txt`)
    expect(planTerminalPathWrite(paths, { failedUnsafe: 0, failedBackend: 0 })).toEqual({ kind: 'too-long' })
  })

  test('uses JSON-escaped length so quoted paths cannot overflow the websocket envelope', () => {
    const path = `/tmp/${'"'.repeat(Math.floor(MAX_TERMINAL_WRITE_CHARS / 2))}`
    const escaped = shellEscapePath(path)
    expect(escaped.length).toBeLessThan(MAX_TERMINAL_WRITE_CHARS)
    expect(JSON.stringify(escaped).length).toBeGreaterThan(MAX_TERMINAL_WRITE_CHARS)
    expect(planTerminalPathWrite([path], { failedUnsafe: 0, failedBackend: 0 })).toEqual({ kind: 'too-long' })
  })

  test('uses UTF-8 byte length for multibyte paths', () => {
    const path = `/tmp/${'你'.repeat(Math.floor(TERMINAL_WS_MESSAGE_LIMIT_BYTES / 2))}`
    expect(path.length).toBeLessThan(MAX_TERMINAL_WRITE_CHARS)
    expect(planTerminalPathWrite([path], { failedUnsafe: 0, failedBackend: 0 })).toEqual({ kind: 'too-long' })
  })
})
