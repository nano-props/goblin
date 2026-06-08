import { describe, expect, test } from 'vitest'
import {
  closeShortcutAccelerators,
  matchBranchActionShortcut,
  matchRendererKeyboardShortcut,
  rendererMenuCommandById,
  resolveRendererMenuCommandAccelerator,
  resolveRendererMenuCommandEnabled,
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

  test('derives close accelerators from the swap preference', () => {
    expect(closeShortcutAccelerators(false)).toEqual({
      closeTab: 'CmdOrCtrl+Shift+W',
      closeWindow: 'CmdOrCtrl+W',
    })
    expect(closeShortcutAccelerators(true)).toEqual({
      closeTab: 'CmdOrCtrl+W',
      closeWindow: 'CmdOrCtrl+Shift+W',
    })
  })

  test('matches renderer navigation and app shortcuts from keyboard input', () => {
    expect(matchRendererKeyboardShortcut({ key: 'j', code: 'KeyJ', shiftKey: false })).toBe('next-branch')
    expect(matchRendererKeyboardShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false })).toBe('prev-detail-tab')
    expect(matchRendererKeyboardShortcut({ key: 'Enter', code: 'Enter', shiftKey: false })).toBe('checkout-selected')
    expect(matchRendererKeyboardShortcut({ key: '?', code: 'Slash', shiftKey: true })).toBe('show-help')
    expect(matchRendererKeyboardShortcut({ key: 'Escape', code: 'Escape', shiftKey: false })).toBe('dismiss')
  })

  test('resolves renderer menu command accelerators and enabled state from shared definitions', () => {
    expect(
      resolveRendererMenuCommandAccelerator(rendererMenuCommandById('file-close-tab'), {
        swapCloseShortcuts: false,
        workspaceLayout: 'top-bottom',
      }),
    ).toBe('CmdOrCtrl+Shift+W')
    expect(
      resolveRendererMenuCommandAccelerator(rendererMenuCommandById('file-close-tab'), {
        swapCloseShortcuts: true,
        workspaceLayout: 'top-bottom',
      }),
    ).toBe('CmdOrCtrl+W')
    expect(
      resolveRendererMenuCommandEnabled(rendererMenuCommandById('view-toggle-detail'), {
        swapCloseShortcuts: false,
        workspaceLayout: 'top-bottom',
      }),
    ).toBe(true)
    expect(
      resolveRendererMenuCommandEnabled(rendererMenuCommandById('view-toggle-detail'), {
        swapCloseShortcuts: false,
        workspaceLayout: 'left-right',
      }),
    ).toBe(false)
  })
})
