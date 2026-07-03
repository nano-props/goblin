// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_COLOR_THEME } from '#/shared/color-theme.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { useLanSettings } from '#/web/runtime-settings-lan.ts'
import { useRuntimeRecentRepos } from '#/web/settings-read-projection.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useThemeStore } from '#/web/stores/theme.ts'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  useThemeStore.setState({
    pref: 'auto',
    resolved: 'light',
    colorTheme: DEFAULT_COLOR_THEME,
    hydrate: async () => {},
    setPref: async () => {},
    setColorTheme: async () => {},
  })
  useI18nStore.setState({
    lang: 'en',
    pref: 'auto',
    dict: {},
    hydrate: async () => {},
    setPref: async () => {},
  })
})

describe('runtime settings hooks', () => {
  test('reads fetch, shortcut, and lan settings from the runtime settings snapshot', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        globalShortcut: 'CommandOrControl+Shift+K',
        globalShortcutRegistered: true,
        lanEnabled: true,
      }),
    )
    let result:
      | {
          fetch: ReturnType<typeof useFetchSettings>
          shortcuts: ReturnType<typeof useShortcutSettings>
          lan: ReturnType<typeof useLanSettings>
        }
      | undefined

    function HookHost() {
      result = {
        fetch: useFetchSettings(),
        shortcuts: useShortcutSettings(),
        lan: useLanSettings(),
      }
      return null
    }

    await renderWithPrimaryWindowQueryClient(<HookHost />)

    expect(result).toMatchObject({
      fetch: {
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
      },
      shortcuts: {
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        globalShortcut: 'CommandOrControl+Shift+K',
        globalShortcutRegistered: true,
      },
      lan: {
        lanEnabled: true,
      },
    })
  })

  test('reads external app runtime settings from the runtime external apps snapshot', async () => {
    primaryWindowQueryClient.setQueryData(externalAppsQueryKey(), {
      terminal: {
        available: true,
        appAvailability: { ghostty: true, terminal: false, windowsTerminal: false },
        detectedAt: 1,
      },
      editor: {
        available: true,
        appAvailability: { vscode: true },
        detectedAt: 1,
      },
    })
    let result: ReturnType<typeof useExternalAppSettings> | undefined

    function HookHost() {
      result = useExternalAppSettings()
      return null
    }

    await renderWithPrimaryWindowQueryClient(<HookHost />)

    expect(result).toMatchObject({
      terminalAvailable: true,
      editorAvailable: true,
    })
  })

  test('reads recent repos from the runtime recent repos state', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        recentRepos: [
          { kind: 'local', id: '/tmp/repo-a' },
          { kind: 'local', id: '/tmp/repo-b' },
        ],
      }),
    )
    let result: ReturnType<typeof useRuntimeRecentRepos> | undefined

    function HookHost() {
      result = useRuntimeRecentRepos()
      return null
    }

    await renderWithPrimaryWindowQueryClient(<HookHost />)

    expect(result).toEqual([
      { kind: 'local', id: '/tmp/repo-a' },
      { kind: 'local', id: '/tmp/repo-b' },
    ])
  })
})

function renderWithPrimaryWindowQueryClient(element: React.ReactElement) {
  return renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
}
