import { describe, expect, test } from 'vitest'
import {
  matchBranchActionShortcut,
  matchRendererKeyboardShortcut,
  clientMenuCommandById,
  resolveClientMenuCommandAccelerator,
} from '#/shared/shortcut-definitions.ts'

describe('shortcut definitions', () => {
  test('matches branch action shortcuts from keyboard input', () => {
    expect(matchBranchActionShortcut({ code: 'KeyP', shiftKey: false })).toBe('pull')
    expect(matchBranchActionShortcut({ code: 'KeyP', shiftKey: true })).toBe('push')
    expect(matchBranchActionShortcut({ code: 'KeyG', shiftKey: false })).toBe('terminal')
    expect(matchBranchActionShortcut({ code: 'KeyG', shiftKey: true })).toBe('remote')
    expect(matchBranchActionShortcut({ code: 'KeyV', shiftKey: false })).toBe('editor')
    expect(matchBranchActionShortcut({ code: 'KeyV', shiftKey: true })).toBeNull()
  })

  test('matches client navigation and app shortcuts from keyboard input', () => {
    expect(matchRendererKeyboardShortcut({ key: 'j', code: 'KeyJ', shiftKey: false })).toBe('next-branch')
    expect(matchRendererKeyboardShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false })).toBe(
      'prev-workspace-pane-view',
    )
    expect(matchRendererKeyboardShortcut({ key: 'Enter', code: 'Enter', shiftKey: false })).toBeNull()
    expect(matchRendererKeyboardShortcut({ key: '?', code: 'Slash', shiftKey: true })).toBe('show-help')
    expect(matchRendererKeyboardShortcut({ key: 'Escape', code: 'Escape', shiftKey: false })).toBe('dismiss')
  })

  test('resolves fixed close and workspace tab accelerators from shared definitions', () => {
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-new-terminal-tab'), {})).toBe(
      'CmdOrCtrl+N',
    )
    expect(
      resolveClientMenuCommandAccelerator(clientMenuCommandById('file-close-workspace-tab-or-window'), {}),
    ).toBe('CmdOrCtrl+W')
    expect(resolveClientMenuCommandAccelerator(clientMenuCommandById('file-close-tab'), {})).toBe(
      'CmdOrCtrl+Shift+W',
    )
  })

  test('defines the terminal primary action as the single terminal shortcut', () => {
    const command = clientMenuCommandById('view-terminal')
    expect(command.menuLabelKey).toBe('menu.view.terminal')
    expect(command.intent).toEqual({ type: 'terminal-primary-action-requested' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBeUndefined()
  })

  test('defines history as a workspace pane view menu command', () => {
    const command = clientMenuCommandById('view-history')
    expect(command.menuLabelKey).toBe('menu.view.history')
    expect(command.intent).toEqual({ type: 'show-workspace-pane-view-requested', tab: 'history' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBeUndefined()
  })

  test('defines the focus mode toggle shortcut', () => {
    const command = clientMenuCommandById('view-toggle-focus-mode')
    expect(command.menuLabelKey).toBe('workspace.focus-toggle-label')
    expect(command.intent).toEqual({ type: 'workspace-focus-toggle-requested' })
    expect(resolveClientMenuCommandAccelerator(command, {})).toBe('CmdOrCtrl+B')
  })
})
