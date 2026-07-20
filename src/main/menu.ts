// Application menu. Two purposes:
//   1) Provide native macOS menu bar entries (File / View / Window / Help)
//   2) Wire global keyboard shortcuts that should work regardless of
//      which element has focus — e.g. ⌘O always opens a workspace.
//
// Client-driven actions (Open / Close Tab / Switch Tab / Refresh /
// Toggle View) are dispatched as typed IPC events so the
// client can run them in its existing store/state, instead of
// duplicating that logic in main.
// A small number of truly native menu actions (for example open data
// folder, open in browser, and native-only projections) still run in
// main because they need Electron shell APIs.
//
// Labels run through `t()` so the menu re-renders in the active
// language whenever `setCurrentLang` fires (the i18n IPC handler
// rebuilds this menu on lang change).

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { activatePrimaryWindow, getPrimaryWindow, resetPrimaryWindow } from '#/main/window.ts'
import { menuNodeLog } from '#/node/logger.ts'
import { openDataFolderMenuKey, t } from '#/main/i18n/index.ts'
import { sendClientEffectIntent } from '#/main/client-surface-events.ts'
import { getTheme } from '#/main/theme.ts'
import { formatWorkspaceSessionEntryLocator } from '#/shared/workspace-display-location.ts'
import type { LangPref, ThemePref } from '#/shared/api-types.ts'
import { isRemoteWorkspaceId, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { focusedRegisteredSurface } from '#/main/client-surface-registry.ts'
import { readMenuRuntimeState } from '#/main/menu-state.ts'
import {
  clientMenuCommandById,
  resolveClientMenuCommandAccelerator,
  resolveClientMenuCommandEnabled,
  resolveClientMenuCommandIntent,
} from '#/shared/shortcut-definitions.ts'
import {
  openDataFolder as runOpenDataFolder,
  openWebVersionFromMenu as runOpenWebVersionFromMenu,
} from '#/main/native-menu-actions.ts'
import { platform } from '#/main/platform.ts'

interface AppMenuState {
  isMac: boolean
  name: string
  recentWorkspaces: WorkspaceSessionEntry[]
  shortcutsDisabled: boolean
  themePref: ThemePref
  langPref: LangPref
}

type AppMenuCommandContext = Record<string, never>
type MissingWindowPolicy = 'activate' | 'ignore'

const APPEARANCE_MENU_OPTIONS = [
  { pref: 'auto', labelKey: 'settings.appearance.auto' },
  { pref: 'light', labelKey: 'settings.appearance.light' },
  { pref: 'dark', labelKey: 'settings.appearance.dark' },
] as const

const LANGUAGE_MENU_OPTIONS = [
  { pref: 'auto', labelKey: 'settings.lang.auto' },
  { pref: 'en', labelKey: 'settings.lang.en' },
  { pref: 'zh', labelKey: 'settings.lang.zh' },
  { pref: 'ko', labelKey: 'settings.lang.ko' },
  { pref: 'ja', labelKey: 'settings.lang.ja' },
] as const

function send(intent: ClientEffectIntent, missingWindow: MissingWindowPolicy = 'activate'): void {
  void sendClientIntent(intent, missingWindow)
}

async function sendClientIntent(intent: ClientEffectIntent, missingWindow: MissingWindowPolicy): Promise<void> {
  try {
    const existingWindow = getPrimaryWindow() ?? focusedRegisteredSurface()?.window
    if (!existingWindow && missingWindow === 'ignore') return
    const win = existingWindow ?? (await activatePrimaryWindow())
    sendClientEffectIntent(win, intent)
  } catch (err) {
    menuNodeLog.warn({ err }, 'failed to send client intent')
  }
}

function separator(): MenuItemConstructorOptions {
  return { type: 'separator' }
}

export function buildAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createAppMenuTemplate(readMenuState())))
}

function readMenuState(): AppMenuState {
  const runtimeState = readMenuRuntimeState()
  return {
    isMac: platform.isMacOS(),
    name: app.name,
    recentWorkspaces: runtimeState.recentWorkspaces,
    shortcutsDisabled: runtimeState.shortcutsDisabled,
    themePref: getTheme().pref,
    langPref: runtimeState.langPref,
  }
}

function createAppMenuTemplate(state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    ...(state.isMac ? [createMacAppMenu(state)] : []),
    createFileMenu(state),
    createEditMenu(),
    createViewMenu(state),
    createWindowMenu(state),
    createHelpMenu(state),
  ]
}

function createMacAppMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: state.name,
    submenu: [
      {
        label: t('menu.app.about', { name: state.name }),
        click: () => send({ type: 'open-settings-requested', page: 'about' }),
      },
      separator(),
      createClientCommandMenuItem(state, 'app-settings'),
      createAppearanceMenu(state.themePref),
      createLanguageMenu(state.langPref),
      separator(),
      { role: 'services', label: t('menu.app.services') },
      separator(),
      { role: 'hide', label: t('menu.app.hide', { name: state.name }) },
      { role: 'hideOthers', label: t('menu.app.hide-others') },
      { role: 'unhide', label: t('menu.app.show-all') },
      separator(),
      { role: 'quit', label: t('menu.app.quit', { name: state.name }) },
    ],
  }
}

function createFileMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: t('menu.file'),
    submenu: [
      createClientCommandMenuItem(state, 'file-new-terminal-tab'),
      createClientCommandMenuItem(state, 'file-create-worktree'),
      separator(),
      createClientCommandMenuItem(state, 'file-open-local-workspace'),
      createClientCommandMenuItem(state, 'file-open-local-workspace-path'),
      createClientCommandMenuItem(state, 'file-clone-repo'),
      createClientCommandMenuItem(state, 'file-open-remote-workspace'),
      { label: t('menu.file.open-recent'), submenu: createRecentWorkspacesMenu(state.recentWorkspaces) },
      separator(),
      // Repeated close accelerators can arrive after the last window has
      // closed. Close commands are scoped to an existing surface and must
      // never recreate one just to deliver the intent.
      createClientCommandMenuItem(state, 'file-close-workspace-tab-or-window', { missingWindow: 'ignore' }),
      createClientCommandMenuItem(state, 'file-close-workspace', { missingWindow: 'ignore' }),
      { label: t('menu.file.close-window'), click: () => focusedRegisteredSurface()?.window.close() },
      separator(),
      { label: t('menu.file.open-in-browser'), click: () => void openWebVersionFromMenu() },
      // Pick the OS-specific copy so Windows users see "in Explorer"
      // instead of the macOS-only "in Finder". Falls back to the generic
      // label on other platforms.
      { label: t(openDataFolderMenuKey()), click: () => void openDataFolder() },
      ...(state.isMac
        ? []
        : [
            separator(),
            createClientCommandMenuItem(state, 'file-settings'),
            separator(),
            { role: 'quit' as const, label: t('menu.file.quit') },
          ]),
    ],
  }
}

function createRecentWorkspacesMenu(recentWorkspaces: WorkspaceSessionEntry[]): MenuItemConstructorOptions[] {
  if (recentWorkspaces.length === 0) return [{ label: t('menu.file.no-recent'), enabled: false }]

  const home = app.getPath('home')
  const localWorkspaceItems = recentWorkspaces
    .filter((entry) => !isRemoteWorkspaceId(entry.id))
    .map((entry) => createRecentWorkspaceMenuItem(entry, home))
  const remoteWorkspaceItems = recentWorkspaces
    .filter((entry) => isRemoteWorkspaceId(entry.id))
    .map((entry) => createRecentWorkspaceMenuItem(entry, home))

  return [
    ...localWorkspaceItems,
    ...(localWorkspaceItems.length > 0 && remoteWorkspaceItems.length > 0 ? [separator()] : []),
    ...remoteWorkspaceItems,
    separator(),
    { label: t('menu.file.clear-recent'), click: () => send({ type: 'clear-recent-workspaces-requested' }) },
  ]
}

function createRecentWorkspaceMenuItem(entry: WorkspaceSessionEntry, home: string): MenuItemConstructorOptions {
  return {
    label: formatWorkspaceSessionEntryLocator(entry, home),
    click: () => send({ type: 'open-recent-workspace-requested', entry }),
  }
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.edit.undo') },
      { role: 'redo', label: t('menu.edit.redo') },
      separator(),
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'pasteAndMatchStyle', label: t('menu.edit.paste-match-style') },
      { role: 'delete', label: t('menu.edit.delete') },
      { role: 'selectAll', label: t('menu.edit.select-all') },
    ],
  }
}

function createViewMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: t('menu.view'),
    submenu: [
      createClientCommandMenuItem(state, 'view-status'),
      createClientCommandMenuItem(state, 'view-history'),
      createClientCommandMenuItem(state, 'view-changes'),
      // Single Terminal entry. Clicking it mirrors what happens when the
      // user clicks the first terminal view on the page: open the terminal
      // tab, focus the first existing session, or create one when the
      // worktree has no terminals yet.
      createClientCommandMenuItem(state, 'view-terminal'),
      createClientCommandMenuItem(state, 'view-toggle-zen-mode'),
      ...(state.isMac ? [] : [separator(), createAppearanceMenu(state.themePref), createLanguageMenu(state.langPref)]),
      separator(),
      createClientCommandMenuItem(state, 'view-refresh'),
      {
        label: t('menu.view.reload-page'),
        accelerator: accelerator(state, 'CmdOrCtrl+R'),
        click: () => focusedRegisteredSurface()?.window.webContents.reload(),
      },
      // On macOS AppKit already injects an "Enter Full Screen" entry into
      // the View menu whenever the window is fullscreenable (the default),
      // so adding one here produces a duplicate. Skip it on darwin and let
      // the system own the entry — that gives us free localization,
      // ⌃⌘F, and a native full-screen transition. On Windows / Linux
      // Electron does not auto-provide it, so we add it manually.
      ...(state.isMac ? [] : [{ role: 'togglefullscreen' as const, label: t('menu.view.toggle-full-screen') }]),
      separator(),
      state.shortcutsDisabled
        ? {
            label: t('menu.view.toggle-dev-tools'),
            click: () => focusedRegisteredSurface()?.window.webContents.toggleDevTools(),
          }
        : {
            role: 'toggleDevTools',
            label: t('menu.view.toggle-dev-tools'),
            accelerator: state.isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          },
    ],
  }
}

function createWindowMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: t('menu.window'),
    submenu: [
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'zoom', label: t('menu.window.zoom') },
      separator(),
      createClientCommandMenuItem(state, 'window-next-workspace'),
      createClientCommandMenuItem(state, 'window-prev-workspace'),
      separator(),
      createClientCommandMenuItem(state, 'window-reset-layout', {
        // Reset Window also restores the main window itself to its default
        // size, so users have a one-click escape from an awkward
        // drag-resize — not just from an awkward pane split.
        beforeIntent: () => resetPrimaryWindow(),
      }),
      ...(state.isMac ? [separator(), { role: 'front' as const, label: t('menu.window.front') }] : []),
    ],
  }
}

function createHelpMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: t('menu.help'),
    submenu: [createClientCommandMenuItem(state, 'help-shortcuts')],
  }
}

function createAppearanceMenu(themePref: ThemePref): MenuItemConstructorOptions {
  return {
    label: t('settings.appearance'),
    submenu: APPEARANCE_MENU_OPTIONS.map(({ pref, labelKey }) => ({
      type: 'radio' as const,
      label: t(labelKey),
      checked: themePref === pref,
      click: () => send({ type: 'theme-pref-set-requested', pref }),
    })),
  }
}

function createLanguageMenu(langPref: LangPref): MenuItemConstructorOptions {
  return {
    label: t('settings.lang'),
    submenu: LANGUAGE_MENU_OPTIONS.map(({ pref, labelKey }) => ({
      type: 'radio' as const,
      label: t(labelKey),
      checked: langPref === pref,
      click: () => send({ type: 'lang-pref-set-requested', pref }),
    })),
  }
}

function accelerator(state: AppMenuState, value: string): string | undefined {
  return state.shortcutsDisabled ? undefined : value
}

function createClientCommandMenuItem(
  state: AppMenuState,
  id: Parameters<typeof clientMenuCommandById>[0],
  // `beforeIntent` runs a main-side side effect before the client
  // intent is dispatched — for actions like Reset Window that need to
  // touch the Electron window itself, not just the client state.
  options?: { beforeIntent?: () => void; missingWindow?: MissingWindowPolicy },
): MenuItemConstructorOptions {
  const command = clientMenuCommandById(id)
  const context = menuCommandContext(state)
  const resolvedAccelerator = resolveClientMenuCommandAccelerator(command, context)
  const resolvedEnabled = resolveClientMenuCommandEnabled(command, context)
  return {
    label: t(command.menuLabelKey),
    ...(resolvedAccelerator ? { accelerator: accelerator(state, resolvedAccelerator) } : {}),
    ...(resolvedEnabled !== undefined ? { enabled: resolvedEnabled } : {}),
    click: () => {
      options?.beforeIntent?.()
      send(resolveClientMenuCommandIntent(command, context), options?.missingWindow)
    },
  }
}

function menuCommandContext(state: AppMenuState): AppMenuCommandContext {
  void state
  return {}
}

async function openWebVersionFromMenu(): Promise<void> {
  await runOpenWebVersionFromMenu()
}

async function openDataFolder(): Promise<void> {
  await runOpenDataFolder()
}
