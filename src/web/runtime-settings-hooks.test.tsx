// @vitest-environment jsdom

import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_COLOR_THEME } from '#/shared/color-theme.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { useRuntimeExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { useRuntimeFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { useRuntimeGeneralSettings } from '#/web/runtime-settings-general.ts'
import { useRuntimeLanSettings } from '#/web/runtime-settings-lan.ts'
import { useRuntimeRecentRepos } from '#/web/runtime-settings-recent-repos.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useThemeStore } from '#/web/stores/theme.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  mainWindowQueryClient.clear()
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

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  mainWindowQueryClient.clear()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('runtime settings hooks', () => {
  test('reads fetch, shortcut, and lan settings from the runtime settings snapshot', async () => {
    mainWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        swapCloseShortcuts: true,
        globalShortcut: 'CommandOrControl+Shift+K',
        globalShortcutRegistered: true,
        lanEnabled: true,
      }),
    )
    let result:
      | {
          fetch: ReturnType<typeof useRuntimeFetchSettings>
          shortcuts: ReturnType<typeof useRuntimeShortcutSettings>
          lan: ReturnType<typeof useRuntimeLanSettings>
        }
      | undefined

    function HookHost() {
      result = {
        fetch: useRuntimeFetchSettings(),
        shortcuts: useRuntimeShortcutSettings(),
        lan: useRuntimeLanSettings(),
      }
      return null
    }

    await renderWithMainWindowQueryClient(<HookHost />)

    expect(result).toMatchObject({
      fetch: {
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
      },
      shortcuts: {
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        swapCloseShortcuts: true,
        globalShortcut: 'CommandOrControl+Shift+K',
        globalShortcutRegistered: true,
      },
      lan: {
        lanEnabled: true,
      },
    })
  })

  test('combines theme, i18n, and settings snapshot into general runtime settings', async () => {
    mainWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        toggleDetailOnActionBarBlankClick: true,
      }),
    )
    const setThemePref = async () => {}
    const setColorTheme = async () => {}
    const setLangPref = async () => {}
    useThemeStore.setState((state) => ({
      ...state,
      pref: 'dark',
      colorTheme: 'github',
      setPref: setThemePref,
      setColorTheme,
    }))
    useI18nStore.setState((state) => ({
      ...state,
      pref: 'ja',
      setPref: setLangPref,
    }))
    let result: ReturnType<typeof useRuntimeGeneralSettings> | undefined

    function HookHost() {
      result = useRuntimeGeneralSettings()
      return null
    }

    await renderWithMainWindowQueryClient(<HookHost />)

    expect(result).toMatchObject({
      themePref: 'dark',
      colorTheme: 'github',
      langPref: 'ja',
      toggleDetailOnActionBarBlankClick: true,
      setThemePref,
      setColorTheme,
      setLangPref,
    })
  })

  test('reads external app runtime settings from the runtime external apps snapshot', async () => {
    mainWindowQueryClient.setQueryData(externalAppsQueryKey(), {
      terminal: {
        pref: 'ghostty',
        resolved: 'ghostty',
        available: true,
        appAvailability: { ghostty: true, terminal: false },
        detectedAt: 1,
      },
      editor: {
        pref: 'cursor',
        resolved: 'cursor',
        available: true,
        appAvailability: { vscode: true, cursor: true, windsurf: false },
        detectedAt: 1,
      },
    })
    let result: ReturnType<typeof useRuntimeExternalAppSettings> | undefined

    function HookHost() {
      result = useRuntimeExternalAppSettings()
      return null
    }

    await renderWithMainWindowQueryClient(<HookHost />)

    expect(result).toMatchObject({
      terminalApp: 'ghostty',
      resolvedTerminalApp: 'ghostty',
      terminalAvailable: true,
      editorApp: 'cursor',
      resolvedEditorApp: 'cursor',
      editorAvailable: true,
    })
  })

  test('reads recent repos from the runtime recent repos state', async () => {
    mainWindowQueryClient.setQueryData(
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

    await renderWithMainWindowQueryClient(<HookHost />)

    expect(result).toEqual([
      { kind: 'local', id: '/tmp/repo-a' },
      { kind: 'local', id: '/tmp/repo-b' },
    ])
  })
})

async function renderWithMainWindowQueryClient(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<QueryClientProvider client={mainWindowQueryClient}>{element}</QueryClientProvider>)
    await Promise.resolve()
  })
}
