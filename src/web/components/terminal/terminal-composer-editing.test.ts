import { describe, expect, test } from 'vitest'
import {
  draftOffsetToTextareaOffset,
  planTerminalComposerEdit,
  textareaOffsetToDraftOffset,
  terminalComposerEditCommandForEvent,
} from '#/web/components/terminal/terminal-composer-editing.ts'

describe('planTerminalComposerEdit', () => {
  test.each([
    ['git commit --message', 'git commit ', 11],
    ['git commit --message ', 'git commit ', 11],
    ['one\ntwo', 'one\n', 4],
    ['one\r\ntwo', 'one\r\n', 5],
  ])('deletes the previous shell word without crossing a line', (value, expected, caret) => {
    const plan = planTerminalComposerEdit(value, value.length, value.length, 'word')
    expect(plan.value).toBe(expected)
    expect(plan.caret).toBe(caret)
  })

  test('deletes to the logical line start while preserving CRLF', () => {
    const value = 'first line\r\nsecond line'
    const plan = planTerminalComposerEdit(value, 19, 19, 'line')
    expect(plan.value).toBe('first line\r\nline')
    expect(plan.caret).toBe(12)
  })

  test('replaces a non-collapsed selection for either command', () => {
    expect(planTerminalComposerEdit('abcdef', 2, 4, 'word').value).toBe('abef')
    expect(planTerminalComposerEdit('abcdef', 2, 4, 'line').value).toBe('abef')
  })

  test('returns an empty plan at a line boundary', () => {
    const plan = planTerminalComposerEdit('one\r\ntwo', 4, 4, 'word')
    expect(plan.start).toBe(plan.end)
    expect(plan.value).toBe('one\r\ntwo')
  })
})

describe('terminalComposerEditCommandForEvent', () => {
  const baseEvent = { code: 'KeyW', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }

  test('recognizes only exact desktop Mac Ctrl+W/Ctrl+U chords', () => {
    expect(terminalComposerEditCommandForEvent(baseEvent, true)).toBe('word')
    expect(terminalComposerEditCommandForEvent({ ...baseEvent, code: 'KeyU' }, true)).toBe('line')
    expect(terminalComposerEditCommandForEvent(baseEvent, false)).toBeNull()
    expect(terminalComposerEditCommandForEvent({ ...baseEvent, altKey: true }, true)).toBeNull()
    expect(terminalComposerEditCommandForEvent({ ...baseEvent, metaKey: true }, true)).toBeNull()
    expect(terminalComposerEditCommandForEvent({ ...baseEvent, shiftKey: true }, true)).toBeNull()
    expect(terminalComposerEditCommandForEvent({ ...baseEvent, code: 'KeyX' }, true)).toBeNull()
  })
})

describe('textarea newline offset mapping', () => {
  test('maps CRLF and CR offsets between draft and normalized textarea values', () => {
    const value = 'a\r\nb\rc'
    expect(textareaOffsetToDraftOffset(value, 2)).toBe(3)
    expect(textareaOffsetToDraftOffset(value, 4)).toBe(5)
    expect(draftOffsetToTextareaOffset(value, 3)).toBe(2)
    expect(draftOffsetToTextareaOffset(value, 5)).toBe(4)
  })
})
