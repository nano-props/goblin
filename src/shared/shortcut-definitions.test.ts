import { describe, expect, test } from 'vitest'
import { matchBranchActionShortcut, matchClientKeyboardShortcut } from '#/shared/shortcut-definitions.ts'

describe('shortcut definitions', () => {
  test('matches branch action shortcuts from keyboard input', () => {
    expect(matchBranchActionShortcut({ code: 'KeyP', shiftKey: false })).toBe('pull')
    expect(matchBranchActionShortcut({ code: 'KeyP', shiftKey: true })).toBe('push')
    expect(matchBranchActionShortcut({ code: 'KeyG', shiftKey: false })).toBeNull()
    expect(matchBranchActionShortcut({ code: 'KeyG', shiftKey: true })).toBeNull()
    expect(matchBranchActionShortcut({ code: 'KeyV', shiftKey: false })).toBeNull()
    expect(matchBranchActionShortcut({ code: 'KeyV', shiftKey: true })).toBeNull()
  })

  test('matches client navigation and app shortcuts from keyboard input', () => {
    expect(matchClientKeyboardShortcut({ key: 'j', code: 'KeyJ', shiftKey: false })).toBe('next-branch')
    expect(matchClientKeyboardShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false })).toBe(
      'prev-workspace-pane-tab',
    )
    expect(matchClientKeyboardShortcut({ key: 'Enter', code: 'Enter', shiftKey: false })).toBeNull()
    expect(matchClientKeyboardShortcut({ key: '?', code: 'Slash', shiftKey: true })).toBe('show-help')
    expect(matchClientKeyboardShortcut({ key: 'Escape', code: 'Escape', shiftKey: false })).toBe('dismiss')
  })
})
