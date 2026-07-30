import { describe, expect, test } from 'vitest'
import { planTerminalComposerSubmit } from '#/web/components/terminal/terminal-composer-submit-plan.ts'

describe('planTerminalComposerSubmit', () => {
  test('preserves paste submission for non-Devin and ambiguous process names', () => {
    for (const processName of ['zsh', 'node', 'devin-cli', '']) {
      expect(planTerminalComposerSubmit({ text: 'first\r\nsecond', processName })).toEqual({
        strategy: 'paste-then-enter',
        payload: 'first\r\nsecond',
      })
    }
  })

  test('normalizes Devin typed multiline text while preserving printable Unicode', () => {
    expect(
      planTerminalComposerSubmit({
        text: 'first\r\nsecond\rthird \"quoted\" 你好 /tmp/file name.txt',
        processName: ' DeViN ',
      }),
    ).toEqual({
      strategy: 'typed-then-enter',
      payload: 'first\nsecond\nthird \"quoted\" 你好 /tmp/file name.txt',
    })
  })

  test.each([
    ['NUL', '\x00'],
    ['Tab', '\x09'],
    ['vertical tab', '\x0b'],
    ['escape', '\x1b'],
    ['unit separator', '\x1f'],
    ['DEL', '\x7f'],
    ['C1 control', '\x85'],
  ])('falls back to paste submission for Devin text containing %s', (_name, control) => {
    const text = `before${control}after`
    expect(planTerminalComposerSubmit({ text, processName: 'devin' })).toEqual({
      strategy: 'paste-then-enter',
      payload: text,
    })
  })
})
