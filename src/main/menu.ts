// Application menu. Two purposes:
//   1) Provide native macOS menu bar entries (File / View / Window / Help)
//   2) Wire global keyboard shortcuts that should work regardless of
//      which element has focus — e.g. ⌘O always opens a repo.
//
// Renderer-driven actions (Open / Close Tab / Switch Tab / Refresh /
// Toggle View) are dispatched as typed RPC events so the
// renderer can run them in its existing store/state, instead of
// duplicating that logic in main.
// A small number of truly native menu actions (for example open data
// folder, open in browser, and native-only projections) still run in
// main because they need Electron shell APIs.
//
// Labels run through `t()` so the menu re-renders in the active
// language whenever `setCurrentLang` fires (the i18n IPC handler
// rebuilds this menu on lang change).

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { activateMainWindow, getMainWindow } from '#/main/window.ts'
import { t } from '#/main/i18n/index.ts'
import { sendRendererEffectIntent } from '#/main/renderer-surface-events.ts'
import { getTheme } from '#/main/theme.ts'
import { normalizeWorkspaceLayout, type WorkspaceLayout } from '#/shared/workspace-layout.ts'
import { tildifyPath } from '#/shared/paths.ts'
import type { LangPref, ThemePref } from '#/shared/rpc.ts'
import { remoteTargetSubtitle, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import { focusedRegisteredSurface } from '#/main/window-registry.ts'
import { readMenuRuntimeState, setMenuWorkspaceLayout as setMenuWorkspaceLayoutState } from '#/main/menu-state.ts'
import {
  clearRecentReposFromMenu as runClearRecentReposFromMenu,
  openDataFolder as runOpenDataFolder,
  openWebVersionFromMenu as runOpenWebVersionFromMenu,
  setLangPrefFromMenu as runSetLangPrefFromMenu,
  setThemePrefFromMenu as runSetThemePrefFromMenu,
} from '#/main/native-menu-actions.ts'

interface AppMenuState {
  isMac: boolean
  name: string
  recentRepos: RepoSessionEntry[]
  shortcutsDisabled: boolean
  swapCloseShortcuts: boolean
  themePref: ThemePref
  langPref: LangPref
  workspaceLayout: WorkspaceLayout
}

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

const WORKSPACE_LAYOUT_MENU_OPTIONS = [
  { layout: 'top-bottom', labelKey: 'menu.view.layout-top-bottom' },
  { layout: 'left-right', labelKey: 'menu.view.layout-left-right' },
] as const

// Main keeps an optimistic layout snapshot for the native radio menu.
// At boot it intentionally starts null so readMenuState falls back to the
// persisted session; menu clicks update this immediately, and the renderer
// later confirms the same value through saveSession.
let menuWorkspaceLayout: WorkspaceLayout | null = null

function send(intent: RendererEffectIntent): void {
  void sendRendererIntent(intent)
}

async function sendRendererIntent(intent: RendererEffectIntent): Promise<void> {
  try {
    const win = getMainWindow() ?? focusedRegisteredSurface()?.window ?? (await activateMainWindow())
    sendRendererEffectIntent(win, intent)
  } catch (err) {
    console.warn('[menu] failed to send renderer intent', err)
  }
}

function separator(): MenuItemConstructorOptions {
  return { type: 'separator' }
}

export function setMenuWorkspaceLayout(layout: WorkspaceLayout): void {
  const next = normalizeWorkspaceLayout(layout)
  if (menuWorkspaceLayout === next && readMenuRuntimeState().workspaceLayout === next) return
  menuWorkspaceLayout = next
  setMenuWorkspaceLayoutState(next)
  buildAppMenu()
}

export function buildAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createAppMenuTemplate(readMenuState())))
}

function readMenuState(): AppMenuState {
  const runtimeState = readMenuRuntimeState()
  return {
    isMac: process.platform === 'darwin',
    name: app.name,
    recentRepos: runtimeState.recentRepos,
    shortcutsDisabled: runtimeState.shortcutsDisabled,
    swapCloseShortcuts: runtimeState.swapCloseShortcuts,
    themePref: getTheme().pref,
    langPref: runtimeState.langPref,
    workspaceLayout: normalizeWorkspaceLayout(menuWorkspaceLayout ?? runtimeState.workspaceLayout),
  }
}

function createAppMenuTemplate(state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    ...(state.isMac ? [createMacAppMenu(state)] : []),
    createFileMenu(state),
    createEditMenu(),
    createViewMenu(state),
    createWindowMenu(state),
    createHelpMenu(),
  ]
}

function createMacAppMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: state.name,
    submenu: [
      { label: t('menu.app.about', { name: state.name }), click: () => send({ type: 'open-settings-requested', page: 'about' }) },
      separator(),
      { label: t('menu.app.settings'), accelerator: accelerator(state, 'Cmd+,'), click: () => send({ type: 'open-settings-requested', page: 'general' }) },
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
      {
        label: t('menu.file.open-local-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+O'),
        click: () => send({ type: 'open-repo-requested' }),
      },
      {
        label: t('menu.file.open-local-repo-path'),
        click: () => send({ type: 'open-repo-path-requested' }),
      },
      {
        label: t('menu.file.clone-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+Shift+O'),
        click: () => send({ type: 'clone-repo-requested' }),
      },
      {
        label: t('menu.file.open-remote-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+Shift+R'),
        click: () => send({ type: 'open-remote-repo-requested' }),
      },
      { label: t('menu.file.open-recent'), submenu: createRecentReposMenu(state.recentRepos) },
      { label: t('menu.file.open-in-browser'), click: () => void openWebVersionFromMenu() },
      { label: t('menu.file.open-data-folder'), click: () => void openDataFolder() },
      // Close-window uses Electron's `role: 'close'` so it works even
      // when the renderer is hung. The swap setting flips which shortcut
      // closes the window vs. the tab. Default: ⌘W = close window,
      // ⌘⇧W = close tab. Swapped: ⌘W = close tab, ⌘⇧W = close window.
      state.shortcutsDisabled
        ? { label: t('menu.file.close-window'), click: () => focusedRegisteredSurface()?.window.close() }
        : {
            role: 'close',
            label: t('menu.file.close-window'),
            accelerator: state.swapCloseShortcuts ? 'CmdOrCtrl+Shift+W' : 'CmdOrCtrl+W',
          },
      {
        label: t('menu.file.close-tab'),
        accelerator: accelerator(state, state.swapCloseShortcuts ? 'CmdOrCtrl+W' : 'CmdOrCtrl+Shift+W'),
        click: () => send({ type: 'close-repo-requested' }),
      },
      ...(state.isMac
        ? []
        : [
            separator(),
            {
              label: t('menu.file.settings'),
              accelerator: accelerator(state, 'Ctrl+,'),
              click: () => send({ type: 'open-settings-requested', page: 'general' }),
            },
            separator(),
            { role: 'quit' as const, label: t('menu.file.quit') },
          ]),
    ],
  }
}

function createRecentReposMenu(recentRepos: RepoSessionEntry[]): MenuItemConstructorOptions[] {
  const home = app.getPath('home')
  return recentRepos.length > 0
    ? [
        ...recentRepos.map((entry) => ({
          label:
            entry.kind === 'local'
              ? tildifyPath(entry.id, home)
              : `${entry.ref.displayName} — ${entry.ref.alias}:${entry.ref.remotePath}`,
          click: () => send({ type: 'open-recent-repo-requested', entry }),
        })),
        separator(),
        { label: t('menu.file.clear-recent'), click: () => void clearRecentReposFromMenu() },
      ]
    : [{ label: t('menu.file.no-recent'), enabled: false }]
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: t('menu.edit'),
    submenu: [
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'selectAll', label: t('menu.edit.select-all') },
    ],
  }
}

function createViewMenu(state: AppMenuState): MenuItemConstructorOptions {
  return {
    label: t('menu.view'),
    submenu: [
      {
        label: t('menu.view.status'),
        accelerator: accelerator(state, 'CmdOrCtrl+1'),
        click: () => send({ type: 'show-detail-tab-requested', tab: 'status' }),
      },
      {
        label: t('menu.view.terminal'),
        accelerator: accelerator(state, 'CmdOrCtrl+2'),
        click: () => send({ type: 'show-detail-tab-requested', tab: 'terminal' }),
      },
      {
        label: t('menu.view.terminal-primary-action'),
        accelerator: accelerator(state, 'CmdOrCtrl+Enter'),
        click: () => send({ type: 'terminal-primary-action-requested' }),
      },
      createWorkspaceLayoutMenu(state.workspaceLayout),
      {
        label: t('menu.view.toggle-detail'),
        accelerator: accelerator(state, 'CmdOrCtrl+J'),
        enabled: state.workspaceLayout === 'top-bottom',
        click: () => send({ type: 'toggle-detail-requested' }),
      },
      ...(state.isMac ? [] : [separator(), createAppearanceMenu(state.themePref), createLanguageMenu(state.langPref)]),
      separator(),
      {
        label: t('menu.view.refresh'),
        accelerator: accelerator(state, 'CmdOrCtrl+R'),
        click: () => send({ type: 'repo-refresh-requested' }),
      },
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
      {
        label: t('menu.window.next-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+]'),
        click: () => send({ type: 'cycle-repo-requested', direction: 1 }),
      },
      {
        label: t('menu.window.prev-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+['),
        click: () => send({ type: 'cycle-repo-requested', direction: -1 }),
      },
      separator(),
      { label: t('menu.window.reset-layout'), click: () => send({ type: 'workspace-layout-reset-requested' }) },
      separator(),
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'zoom', label: t('menu.window.zoom') },
      ...(state.isMac ? [separator(), { role: 'front' as const, label: t('menu.window.front') }] : []),
    ],
  }
}

function createHelpMenu(): MenuItemConstructorOptions {
  return {
    label: t('menu.help'),
    // No menu accelerator: Electron requires a modifier on accelerators,
    // and bare `?` is rejected at registration. The renderer's keyboard
    // hook handles `?` directly so the binding still works.
    submenu: [{ label: t('menu.help.shortcuts'), click: () => send({ type: 'open-settings-requested', page: 'shortcuts' }) }],
  }
}

function createWorkspaceLayoutMenu(workspaceLayout: WorkspaceLayout): MenuItemConstructorOptions {
  return {
    label: t('menu.view.workspace-layout'),
    submenu: WORKSPACE_LAYOUT_MENU_OPTIONS.map(({ layout, labelKey }) => ({
      type: 'radio' as const,
      label: t(labelKey),
      checked: workspaceLayout === layout,
      click: () => setWorkspaceLayoutFromMenu(layout),
    })),
  }
}

function createAppearanceMenu(themePref: ThemePref): MenuItemConstructorOptions {
  return {
    label: t('settings.appearance'),
    submenu: APPEARANCE_MENU_OPTIONS.map(({ pref, labelKey }) => ({
      type: 'radio' as const,
      label: t(labelKey),
      checked: themePref === pref,
      click: () => void setThemePrefFromMenu(pref),
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
      click: () => void setLangPrefFromMenu(pref),
    })),
  }
}

function accelerator(state: AppMenuState, value: string): string | undefined {
  return state.shortcutsDisabled ? undefined : value
}

function setWorkspaceLayoutFromMenu(layout: WorkspaceLayout): void {
  setMenuWorkspaceLayout(layout)
  send({ type: 'workspace-layout-set-requested', layout })
}

async function setThemePrefFromMenu(pref: ThemePref): Promise<void> {
  await runSetThemePrefFromMenu(pref)
}

async function setLangPrefFromMenu(pref: LangPref): Promise<void> {
  await runSetLangPrefFromMenu(pref, { rebuildMenu: buildAppMenu })
}

async function openWebVersionFromMenu(): Promise<void> {
  await runOpenWebVersionFromMenu()
}

async function clearRecentReposFromMenu(): Promise<void> {
  await runClearRecentReposFromMenu()
}

async function openDataFolder(): Promise<void> {
  await runOpenDataFolder()
}
