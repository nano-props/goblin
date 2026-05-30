// Application menu. Two purposes:
//   1) Provide native macOS menu bar entries (File / View / Window / Help)
//   2) Wire global keyboard shortcuts that should work regardless of
//      which element has focus — e.g. ⌘O always opens a repo.
//
// Renderer-driven actions (Open / Close Tab / Switch Tab / Refresh /
// Toggle View) are dispatched as typed RPC events so the
// renderer can run them in its existing store/state, instead of
// duplicating that logic in main.
//
// Labels run through `t()` so the menu re-renders in the active
// language whenever `setCurrentLang` fires (the i18n IPC handler
// rebuilds this menu on lang change).

import { app, Menu, shell, dialog, type MenuItemConstructorOptions, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { activateMainWindow, getMainWindow } from '#/main/window.ts'
import { applyLangPref, t } from '#/main/i18n/index.ts'
import {
  clearRecentRepos,
  getLangPref,
  getRecentRepos,
  getSession,
  getShortcutsDisabled,
  getSwapCloseShortcuts,
} from '#/main/settings.ts'
import { broadcastRpcEvent, sendRpcEvent } from '#/main/events.ts'
import { getTheme, setThemePref } from '#/main/theme.ts'
import { normalizeWorkspaceLayout, type WorkspaceLayout } from '#/shared/workspace-layout.ts'
import { tildifyPath } from '#/shared/paths.ts'
import type { LangPref, MenuAction, ThemePref } from '#/shared/rpc.ts'

interface AppMenuState {
  isMac: boolean
  name: string
  recentRepos: string[]
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

function send(action: MenuAction): void {
  void sendMenuAction(action)
}

async function sendMenuAction(action: MenuAction): Promise<void> {
  try {
    const win = getMainWindow() ?? BrowserWindow.getFocusedWindow() ?? (await activateMainWindow())
    sendRpcEvent(win, { type: 'menu-action', action })
  } catch (err) {
    console.warn('[menu] failed to send menu action', err)
  }
}

function separator(): MenuItemConstructorOptions {
  return { type: 'separator' }
}

export function setMenuWorkspaceLayout(layout: WorkspaceLayout): void {
  const next = normalizeWorkspaceLayout(layout)
  if (menuWorkspaceLayout === next) return
  menuWorkspaceLayout = next
  buildAppMenu()
}

export function buildAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createAppMenuTemplate(readMenuState())))
}

function readMenuState(): AppMenuState {
  return {
    isMac: process.platform === 'darwin',
    name: app.name,
    recentRepos: getRecentRepos(),
    shortcutsDisabled: getShortcutsDisabled(),
    swapCloseShortcuts: getSwapCloseShortcuts(),
    themePref: getTheme().pref,
    langPref: getLangPref(),
    workspaceLayout: normalizeWorkspaceLayout(menuWorkspaceLayout ?? getSession().workspaceLayout),
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
      { label: t('menu.app.about', { name: state.name }), click: () => send('open-about') },
      separator(),
      { label: t('menu.app.settings'), accelerator: accelerator(state, 'Cmd+,'), click: () => send('open-settings') },
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
        click: () => send('open-repo'),
      },
      {
        label: t('menu.file.open-local-repo-path'),
        click: () => send('open-repo-path'),
      },
      {
        label: t('menu.file.clone-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+Shift+O'),
        click: () => send('clone-repo'),
      },
      { label: t('menu.file.open-recent'), submenu: createRecentReposMenu(state.recentRepos) },
      { label: t('menu.file.open-data-folder'), click: () => void openDataFolder() },
      // Close-window uses Electron's `role: 'close'` so it works even
      // when the renderer is hung. The swap setting flips which shortcut
      // closes the window vs. the tab. Default: ⌘W = close window,
      // ⌘⇧W = close tab. Swapped: ⌘W = close tab, ⌘⇧W = close window.
      state.shortcutsDisabled
        ? { label: t('menu.file.close-window'), click: () => BrowserWindow.getFocusedWindow()?.close() }
        : {
            role: 'close',
            label: t('menu.file.close-window'),
            accelerator: state.swapCloseShortcuts ? 'CmdOrCtrl+Shift+W' : 'CmdOrCtrl+W',
          },
      {
        label: t('menu.file.close-tab'),
        accelerator: accelerator(state, state.swapCloseShortcuts ? 'CmdOrCtrl+W' : 'CmdOrCtrl+Shift+W'),
        click: () => send('close-repo'),
      },
      ...(state.isMac
        ? []
        : [
            separator(),
            {
              label: t('menu.file.settings'),
              accelerator: accelerator(state, 'Ctrl+,'),
              click: () => send('open-settings'),
            },
            separator(),
            { role: 'quit' as const, label: t('menu.file.quit') },
          ]),
    ],
  }
}

function createRecentReposMenu(recentRepos: string[]): MenuItemConstructorOptions[] {
  const home = app.getPath('home')
  return recentRepos.length > 0
    ? [
        ...recentRepos.map((repoPath) => ({
          label: tildifyPath(repoPath, home),
          click: () => send({ type: 'open-recent-repo', path: repoPath }),
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
      { label: t('menu.view.status'), accelerator: accelerator(state, 'CmdOrCtrl+1'), click: () => send('tab-status') },
      {
        label: t('menu.view.changes'),
        accelerator: accelerator(state, 'CmdOrCtrl+2'),
        click: () => send('tab-changes'),
      },
      { label: t('menu.view.log'), accelerator: accelerator(state, 'CmdOrCtrl+3'), click: () => send('tab-log') },
      {
        label: t('menu.view.terminal'),
        accelerator: accelerator(state, 'CmdOrCtrl+4'),
        click: () => send('tab-terminal'),
      },
      createWorkspaceLayoutMenu(state.workspaceLayout),
      {
        label: t('menu.view.toggle-detail'),
        accelerator: accelerator(state, 'CmdOrCtrl+J'),
        enabled: state.workspaceLayout === 'top-bottom',
        click: () => send('toggle-detail'),
      },
      ...(state.isMac ? [] : [separator(), createAppearanceMenu(state.themePref), createLanguageMenu(state.langPref)]),
      separator(),
      { label: t('menu.view.refresh'), accelerator: accelerator(state, 'CmdOrCtrl+R'), click: () => send('refresh') },
      separator(),
      state.shortcutsDisabled
        ? {
            label: t('menu.view.toggle-dev-tools'),
            click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
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
        click: () => send('next-repo'),
      },
      {
        label: t('menu.window.prev-repo'),
        accelerator: accelerator(state, 'CmdOrCtrl+['),
        click: () => send('prev-repo'),
      },
      separator(),
      { label: t('menu.window.reset-layout'), click: () => send('reset-layout') },
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
    submenu: [{ label: t('menu.help.shortcuts'), click: () => send('show-help') }],
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
  send({ type: 'set-workspace-layout', layout })
}

async function setThemePrefFromMenu(pref: ThemePref): Promise<void> {
  try {
    await setThemePref(pref)
  } catch (err) {
    console.warn('[menu] failed to set theme preference', err)
  }
}

async function setLangPrefFromMenu(pref: LangPref): Promise<void> {
  try {
    const payload = await applyLangPref(pref)
    if (!payload) return
    buildAppMenu()
    broadcastRpcEvent({ type: 'i18n-changed', payload })
  } catch (err) {
    console.warn('[menu] failed to set language preference', err)
  }
}

async function clearRecentReposFromMenu(): Promise<void> {
  await clearRecentRepos()
  buildAppMenu()
}

async function openDataFolder(): Promise<void> {
  try {
    const dir = app.getPath('userData')
    await fs.mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) reportOpenDataFolderError(error)
  } catch (err) {
    reportOpenDataFolderError(err)
  }
}

function reportOpenDataFolderError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn('[menu] failed to open data folder', err)
  dialog.showErrorBox(t('menu.file.open-data-folder'), message)
}
