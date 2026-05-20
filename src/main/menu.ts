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

import { app, Menu, type MenuItemConstructorOptions, BrowserWindow } from 'electron'
import { getMainWindow } from '#/main/window.ts'
import { t } from '#/main/i18n/index.ts'

export type MenuAction =
  | 'open-repo'
  | 'close-repo'
  | 'next-repo'
  | 'prev-repo'
  | 'refresh'
  | 'tab-status'
  | 'tab-log'
  | 'toggle-theme'
  | 'open-settings'
  | 'show-help'

function send(action: MenuAction): void {
  const win = getMainWindow() ?? BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('app:menu-invoke', action)
}

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const name = app.name

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file'),
    submenu: [
      { label: t('menu.file.openRepo'), accelerator: 'CmdOrCtrl+O', click: () => send('open-repo') },
      // ⌘W is the standard OS shortcut for closing the window — keep
      // the `role: 'close'` accelerator there so it still works even if
      // the renderer hasn't subscribed to menu actions yet (e.g. hung
      // renderer). Closing a repo tab moves to ⌘⇧W.
      { role: 'close', accelerator: 'CmdOrCtrl+W' },
      { label: t('menu.file.closeTab'), accelerator: 'CmdOrCtrl+Shift+W', click: () => send('close-repo') },
      { type: 'separator' },
      {
        label: t('menu.file.settings'),
        accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
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
      { role: 'selectAll', label: t('menu.edit.selectAll') },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [
      { label: t('menu.view.status'), accelerator: 'CmdOrCtrl+2', click: () => send('tab-status') },
      { label: t('menu.view.log'), accelerator: 'CmdOrCtrl+3', click: () => send('tab-log') },
      { type: 'separator' },
      { label: t('menu.view.refresh'), accelerator: 'CmdOrCtrl+R', click: () => send('refresh') },
      { label: t('menu.view.toggleTheme'), accelerator: 'CmdOrCtrl+Shift+T', click: () => send('toggle-theme') },
      { type: 'separator' },
      {
        role: 'toggleDevTools',
        label: t('menu.view.toggleDevTools'),
        accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
      },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window'),
    submenu: [
      { label: t('menu.window.nextRepo'), accelerator: 'CmdOrCtrl+]', click: () => send('next-repo') },
      { label: t('menu.window.prevRepo'), accelerator: 'CmdOrCtrl+[', click: () => send('prev-repo') },
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
    submenu: [{ label: t('menu.help.shortcuts'), click: () => send('show-help') }],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: name,
            submenu: [
              { role: 'about' as const, label: t('menu.app.about', { name }) },
              { type: 'separator' as const },
              { label: t('menu.app.settings'), accelerator: 'Cmd+,', click: () => send('open-settings') },
              { type: 'separator' as const },
              { role: 'services' as const, label: t('menu.app.services') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('menu.app.hide', { name }) },
              { role: 'hideOthers' as const, label: t('menu.app.hideOthers') },
              { role: 'unhide' as const, label: t('menu.app.showAll') },
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
