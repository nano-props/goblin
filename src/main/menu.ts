// Application menu. Two purposes:
//   1) Provide native macOS menu bar entries (File / View / Window / Help)
//   2) Wire global keyboard shortcuts that should work regardless of
//      which element has focus — e.g. ⌘O always opens a repo.
//
// Renderer-driven actions (Open / Close Tab / Switch Tab / Refresh /
// Toggle View) are dispatched as `app:menu-invoke` IPC events so the
// renderer can run them in its existing store/state, instead of
// duplicating that logic in main.
//
// Labels run through `t()` so the menu re-renders in the active
// language whenever `setCurrentLang` fires (the i18n IPC handler
// rebuilds this menu on lang change).

import { app, Menu, shell, dialog, type MenuItemConstructorOptions, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { getMainWindow } from '#/main/window.ts'
import { t } from '#/main/i18n/index.ts'
import { clearRecentRepos, getRecentRepos, getShortcutsDisabled } from '#/main/settings.ts'

export type MenuAction =
  | 'open-repo'
  | 'close-repo'
  | 'next-repo'
  | 'prev-repo'
  | 'refresh'
  | 'tab-status'
  | 'tab-changes'
  | 'tab-log'
  | 'toggle-detail'
  | 'toggle-theme'
  | 'open-settings'
  | 'show-help'
  | { type: 'open-recent-repo'; path: string }

function send(action: MenuAction): void {
  const win = getMainWindow() ?? BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('app:menu-invoke', action)
}

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const name = app.name
  const recentRepos = getRecentRepos()
  const shortcutsDisabled = getShortcutsDisabled()
  const accelerator = (value: string) => (shortcutsDisabled ? undefined : value)
  const recentSubmenu: MenuItemConstructorOptions[] =
    recentRepos.length > 0
      ? [
          ...recentRepos.map((repoPath) => ({
            label: tildify(repoPath),
            click: () => send({ type: 'open-recent-repo', path: repoPath }),
          })),
          { type: 'separator' as const },
          { label: t('menu.file.clear-recent'), click: () => void clearRecentReposFromMenu() },
        ]
      : [{ label: t('menu.file.no-recent'), enabled: false }]

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file'),
    submenu: [
      { label: t('menu.file.open-repo'), accelerator: accelerator('CmdOrCtrl+O'), click: () => send('open-repo') },
      { label: t('menu.file.open-recent'), submenu: recentSubmenu },
      { label: t('menu.file.open-data-folder'), click: () => void openDataFolder() },
      // ⌘W is the standard OS shortcut for closing the window — keep
      // the `role: 'close'` accelerator there when shortcuts are enabled
      // so it still works even if the renderer hasn't subscribed to menu
      // actions yet (e.g. hung renderer). Closing a repo tab moves to ⌘⇧W.
      shortcutsDisabled
        ? { label: t('menu.file.close-window'), click: () => BrowserWindow.getFocusedWindow()?.close() }
        : { role: 'close', label: t('menu.file.close-window'), accelerator: 'CmdOrCtrl+W' },
      {
        label: t('menu.file.close-tab'),
        accelerator: accelerator('CmdOrCtrl+Shift+W'),
        click: () => send('close-repo'),
      },
      { type: 'separator' },
      {
        label: t('menu.file.settings'),
        accelerator: accelerator(isMac ? 'Cmd+,' : 'Ctrl+,'),
        click: () => send('open-settings'),
      },
      ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: t('menu.file.quit') }]),
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'selectAll', label: t('menu.edit.select-all') },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [
      { label: t('menu.view.status'), accelerator: accelerator('CmdOrCtrl+1'), click: () => send('tab-status') },
      { label: t('menu.view.changes'), accelerator: accelerator('CmdOrCtrl+2'), click: () => send('tab-changes') },
      { label: t('menu.view.log'), accelerator: accelerator('CmdOrCtrl+3'), click: () => send('tab-log') },
      {
        label: t('menu.view.toggle-detail'),
        accelerator: accelerator('CmdOrCtrl+J'),
        click: () => send('toggle-detail'),
      },
      { type: 'separator' },
      { label: t('menu.view.refresh'), accelerator: accelerator('CmdOrCtrl+R'), click: () => send('refresh') },
      {
        label: t('menu.view.toggle-theme'),
        accelerator: accelerator('CmdOrCtrl+Shift+T'),
        click: () => send('toggle-theme'),
      },
      { type: 'separator' },
      shortcutsDisabled
        ? {
            label: t('menu.view.toggle-dev-tools'),
            click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
          }
        : {
            role: 'toggleDevTools',
            label: t('menu.view.toggle-dev-tools'),
            accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window'),
    submenu: [
      { label: t('menu.window.next-repo'), accelerator: accelerator('CmdOrCtrl+]'), click: () => send('next-repo') },
      { label: t('menu.window.prev-repo'), accelerator: accelerator('CmdOrCtrl+['), click: () => send('prev-repo') },
      { type: 'separator' },
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'zoom', label: t('menu.window.zoom') },
      ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const, label: t('menu.window.front') }] : []),
    ],
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help'),
    // No menu accelerator: Electron requires a modifier on accelerators,
    // and bare `?` is rejected at registration. The renderer's keyboard
    // hook handles `?` directly so the binding still works.
    submenu: [{ label: t('menu.help.shortcuts'), enabled: !shortcutsDisabled, click: () => send('show-help') }],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: name,
            submenu: [
              { role: 'about' as const, label: t('menu.app.about', { name }) },
              { type: 'separator' as const },
              { label: t('menu.app.settings'), accelerator: accelerator('Cmd+,'), click: () => send('open-settings') },
              { type: 'separator' as const },
              { role: 'services' as const, label: t('menu.app.services') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('menu.app.hide', { name }) },
              { role: 'hideOthers' as const, label: t('menu.app.hide-others') },
              { role: 'unhide' as const, label: t('menu.app.show-all') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('menu.app.quit', { name }) },
            ],
          },
        ]
      : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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

function tildify(p: string): string {
  const home = app.getPath('home')
  if (!home || p === home) return p === home ? '~' : p
  return p.startsWith(home + '/') ? `~${p.slice(home.length)}` : p
}
