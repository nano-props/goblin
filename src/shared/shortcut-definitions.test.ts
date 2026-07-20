import { describe, expect, test } from 'vitest'
import {
  matchBranchActionShortcut,
  matchClientKeyboardShortcut,
  clientMenuCommandById,
  resolveClientMenuCommandAccelerator,
} from '#/shared/shortcut-definitions.ts'

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

  test('resolves fixed close and workspace tab accelerators from shared definitions', () => {
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-new-terminal-tab'), {})).toBe('CmdOrCtrl+T')
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-create-worktree'), {})).toBe('CmdOrCtrl+N')
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-close-workspace-tab-or-window'), {})).toBe(
      'CmdOrCtrl+W',
    )
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-close-workspace'), {})).toBe(
      'CmdOrCtrl+Shift+W',
    )
  })

  test('defines the terminal primary action as the single terminal shortcut', () => {
    const command = clientMenuCommandById('view-terminal')
    expect(command.menuLabelKey).toBe('menu.view.terminal')
    expect(command.intent).toEqual({ type: 'terminal-primary-action-requested' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBeUndefined()
  })

  test('defines history as a workspace pane tab menu command', () => {
    const command = clientMenuCommandById('view-history')
    expect(command.menuLabelKey).toBe('menu.view.history')
    expect(command.intent).toEqual({ type: 'show-workspace-pane-tab-requested', tab: 'history' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBeUndefined()
  })

  test('defines the zen mode toggle shortcut', () => {
    const command = clientMenuCommandById('view-toggle-zen-mode')
    expect(command.menuLabelKey).toBe('workspace.zen-mode-toggle-label')
    expect(command.intent).toEqual({ type: 'workspace-zen-mode-toggle-requested' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBe('CmdOrCtrl+B')
  })
})
