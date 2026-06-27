import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import {
  NativeHostProjectionSchema,
  nativeSettingsProjectionStateFromSettings,
  pickNativeSettingsProjectionPatch,
} from '#/shared/native-host-projection.ts'

describe('native host projection helpers', () => {
  test('picks only settings that affect native projection', () => {
    expect(
      pickNativeSettingsProjectionPatch({
        lang: 'ja',
        shortcutsDisabled: true,
        terminalNotificationsEnabled: true,
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
        globalShortcut: 'Alt+K',
        lanEnabled: false,
      }),
    ).toEqual({
      lang: 'ko',
      theme: 'dark',
      colorTheme: 'github',
      shortcutsDisabled: true,
      globalShortcutDisabled: true,
      globalShortcut: 'Alt+K',
    })
  })

  test('rejects an empty shell projection payload', () => {
    expect(v.safeParse(NativeHostProjectionSchema, {}).success).toBe(false)
  })
})
