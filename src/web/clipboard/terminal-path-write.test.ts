import { describe, expect, test } from 'vitest'
import { MAX_TERMINAL_WRITE_CHARS } from '#/shared/terminal-validators.ts'
import { planTerminalPathWrite, shellEscapePath } from '#/web/clipboard/terminal-path-write.ts'

describe('shellEscapePath', () => {
  test('leaves shell-safe paths unquoted', () => {
    expect(shellEscapePath('/tmp/a-b_1.txt')).toBe('/tmp/a-b_1.txt')
  })

  test('quotes spaces and embedded single quotes', () => {
    expect(shellEscapePath("/tmp/it's here.txt")).toBe("'/tmp/it'\\''s here.txt'")
  })
})

describe('planTerminalPathWrite', () => {
  test('returns a write plan for safe paths and preserves failed count', () => {
    expect(planTerminalPathWrite(['/tmp/a', '/tmp/with space'], 1)).toEqual({
      kind: 'write',
      data: "/tmp/a '/tmp/with space'",
      failed: 1,
    })
  })

  test('filters terminal control characters and reports them as failed', () => {
    expect(planTerminalPathWrite(['/tmp/ok', '/tmp/bad\u001bname'], 0)).toEqual({
      kind: 'write',
      data: '/tmp/ok',
      failed: 1,
    })
  })

  test('returns failed when every path is unsafe', () => {
    expect(planTerminalPathWrite(['/tmp/bad\nname'], 0)).toEqual({ kind: 'failed' })
  })

  test('returns too-long before building an oversized terminal write', () => {
    const hugePath = `/tmp/${'a'.repeat(MAX_TERMINAL_WRITE_CHARS)}`
    expect(planTerminalPathWrite([hugePath], 0)).toEqual({ kind: 'too-long' })
  })
})
