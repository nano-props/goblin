// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_COLOR_THEME } from '#/shared/color-theme.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderHookInJsdom } from '#/test-utils/render.tsx'
import { useExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { useLanSettings } from '#/web/runtime-settings-lan.ts'
import { useRuntimeRecentWorkspaces } from '#/web/settings-read-projection.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useThemeStore } from '#/web/stores/theme.ts'

beforeEach(() => {
  appQueryClient.clear()
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
    appQueryClient.setQueryData(
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
    const { result } = renderHookInJsdom(
      () => ({
        fetch: useFetchSettings(),
        shortcuts: useShortcutSettings(),
        lan: useLanSettings(),
      }),
      { wrapper: AppQueryClientProvider },
    )

    expect(result.current).toMatchObject({
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
    appQueryClient.setQueryData(externalAppsQueryKey(), {
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
    const { result } = renderHookInJsdom(() => useExternalAppSettings(), { wrapper: AppQueryClientProvider })

    expect(result.current).toMatchObject({
      terminalAvailable: true,
      editorAvailable: true,
    })
  })

  test('reads recent repos from the runtime recent repos state', async () => {
    appQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        recentWorkspaces: [
          { id: workspaceIdForTest('goblin+file:///tmp/repo-a') },
          { id: workspaceIdForTest('goblin+file:///tmp/repo-b') },
        ],
      }),
    )
    const { result } = renderHookInJsdom(() => useRuntimeRecentWorkspaces(), { wrapper: AppQueryClientProvider })

    expect(result.current).toEqual([{ id: 'goblin+file:///tmp/repo-a' }, { id: 'goblin+file:///tmp/repo-b' }])
  })
})

function AppQueryClientProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
}
