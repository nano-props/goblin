import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import {
  NativeShellProjectionSchema,
  nativeSettingsProjectionStateFromSettings,
  pickNativeSettingsProjectionPatch,
} from '#/shared/native-shell-projection.ts'

describe('native shell projection helpers', () => {
  test('picks only settings that affect native projection', () => {
    expect(
      pickNativeSettingsProjectionPatch({
        lang: 'ja',
        shortcutsDisabled: true,
        terminalNotificationsEnabled: true,
        terminalApp: 'ghostty',
      }),
    ).toEqual({
      lang: 'ja',
      shortcutsDisabled: true,
    })
  })

  test('returns null when a settings update does not affect native projection', () => {
    expect(
      pickNativeSettingsProjectionPatch({
        terminalNotificationsEnabled: true,
      }),
    ).toBeNull()
  })

  test('derives the native projection state from full settings', () => {
    expect(
      nativeSettingsProjectionStateFromSettings({
        lang: 'ko',
        theme: 'dark',
        colorTheme: 'github',
        fetchIntervalSec: 120,
        terminalNotificationsEnabled: false,
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        swapCloseShortcuts: true,
        globalShortcut: 'Alt+K',
        terminalApp: 'auto',
        editorApp: 'auto',
        lanEnabled: false,
      }),
    ).toEqual({
      lang: 'ko',
      theme: 'dark',
      colorTheme: 'github',
      shortcutsDisabled: true,
      globalShortcutDisabled: true,
      swapCloseShortcuts: true,
      globalShortcut: 'Alt+K',
    })
  })

  test('rejects an empty shell projection payload', () => {
    expect(v.safeParse(NativeShellProjectionSchema, {}).success).toBe(false)
  })
})
