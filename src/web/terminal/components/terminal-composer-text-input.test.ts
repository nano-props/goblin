import { describe, expect, test } from 'vitest'
import { planTerminalComposerTextInput } from '#/web/terminal/components/terminal-composer-text-input.ts'

describe('planTerminalComposerTextInput', () => {
  test('preserves paste input for non-Devin and ambiguous process names', () => {
    for (const processName of ['zsh', 'node', 'devin-cli', '']) {
      expect(planTerminalComposerTextInput({ text: 'first\r\nsecond', processName })).toEqual({
        method: 'paste',
        payload: 'first\r\nsecond',
      })
    }
  })

  test('normalizes Devin typed multiline text while preserving printable Unicode', () => {
    expect(
      planTerminalComposerTextInput({
        text: 'first\r\nsecond\rthird "quoted" 你好 /tmp/file name.txt',
        processName: ' DeViN ',
      }),
    ).toEqual({
      method: 'typed',
      payload: 'first\nsecond\nthird "quoted" 你好 /tmp/file name.txt',
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
  ])('falls back to paste input for Devin text containing %s', (_name, control) => {
    const text = `before${control}after`
    expect(planTerminalComposerTextInput({ text, processName: 'devin' })).toEqual({
      method: 'paste',
      payload: text,
    })
  })
})
