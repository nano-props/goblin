import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

interface MockMenuRuntimeState {
  recentRepos: RepoSessionEntry[]
  shortcutsDisabled: boolean
  swapCloseShortcuts: boolean
  langPref: 'auto' | 'en' | 'zh' | 'ko' | 'ja'
  workspaceLayout: 'top-bottom' | 'left-right' | 'branches'
}

function defaultMenuRuntimeState(): MockMenuRuntimeState {
  return {
    recentRepos: [],
    shortcutsDisabled: false,
    swapCloseShortcuts: false,
    langPref: 'auto',
    workspaceLayout: 'top-bottom',
  }
}

const mocks = vi.hoisted(() => {
  const template: any[] = []
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
  return {
    appGetPath: vi.fn<(name: string) => string>((name: string) => (name === 'home' ? '/home/user' : '/data')),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    readMenuRuntimeState: vi.fn<() => MockMenuRuntimeState>(() => defaultMenuRuntimeState()),
    template,
    win,
    activateMainWindow: vi.fn(() => Promise.resolve(win)),
    getFocusedWindow: vi.fn((): any => null),
    focusedRegisteredSurface: vi.fn((): any => null),
    getMainWindow: vi.fn((): any => null),
    resetMainWindowToDefault: vi.fn(),
    sendRendererEffectIntent: vi.fn(),
    buildFromTemplate: vi.fn((nextTemplate: any[]) => {
      template.splice(0, template.length, ...nextTemplate)
      return nextTemplate
    }),
    setApplicationMenu: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    name: 'Goblin',
    getPath: mocks.appGetPath,
  },
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
  },
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock('#/main/window.ts', () => ({
  activateMainWindow: mocks.activateMainWindow,
  getMainWindow: mocks.getMainWindow,
  resetMainWindowToDefault: mocks.resetMainWindowToDefault,
}))

vi.mock('#/main/window-registry.ts', () => ({
  focusedRegisteredSurface: mocks.focusedRegisteredSurface,
}))

vi.mock('#/main/i18n/index.ts', () => ({
  openDataFolderMenuKey: vi.fn(() => 'menu.file.open-data-folder.mac'),
  t: vi.fn((key: string) => key),
}))

vi.mock('#/main/menu-state.ts', () => ({
  readMenuRuntimeState: mocks.readMenuRuntimeState,
  applyMenuRuntimeState: vi.fn(),
  setMenuWorkspaceLayout: vi.fn(),
}))

vi.mock('#/main/renderer-surface-events.ts', () => ({
  broadcastIpcEvent: vi.fn(),
  sendRendererEffectIntent: mocks.sendRendererEffectIntent,
}))

vi.mock('#/main/window-shell.ts', () => ({
  getRendererBaseUrl: vi.fn(() => 'http://127.0.0.1:32100'),
  getEmbeddedServerUrl: vi.fn(() => 'http://127.0.0.1:32100'),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: mocks.openHttpExternal,
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: vi.fn(() => ({ pref: 'auto', resolved: 'light', colorTheme: 'macos' })),
  applyThemeSettingsProjection: vi.fn(),
  initTheme: vi.fn(),
  subscribeTheme: vi.fn(() => () => {}),
}))

describe('app menu actions', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.template.length = 0
    mocks.appGetPath.mockImplementation((name: string) => (name === 'home' ? '/home/user' : '/data'))
    mocks.readMenuRuntimeState.mockReturnValue(defaultMenuRuntimeState())
    mocks.getMainWindow.mockReturnValue(null)
    mocks.getFocusedWindow.mockReturnValue(null)
    mocks.focusedRegisteredSurface.mockReturnValue(null)
    mocks.activateMainWindow.mockResolvedValue(mocks.win)
    const { platform } = await import('#/main/menu.ts')
    vi.spyOn(platform, 'isMacOS').mockReturnValue(true)
  })

  test('activates the main window before sending an action when no window exists', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo')
    await Promise.resolve()

    expect(mocks.activateMainWindow).toHaveBeenCalledTimes(1)
    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, { type: 'open-repo-requested' })
  })

  test('reuses an existing main window for menu actions', async () => {
    mocks.getMainWindow.mockReturnValue(mocks.win)
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo')
    await Promise.resolve()

    expect(mocks.activateMainWindow).not.toHaveBeenCalled()
    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, { type: 'open-repo-requested' })
  })

  test('sends the path dialog action from the file menu', async () => {
    mocks.getMainWindow.mockReturnValue(mocks.win)
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo-path')
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, { type: 'open-repo-path-requested' })
  })

  test('tildifies Windows home paths in the recent repos menu', async () => {
    mocks.appGetPath.mockImplementation((name: string) => (name === 'home' ? 'C:\\Users\\user' : '/data'))
    mocks.readMenuRuntimeState.mockReturnValue({
      ...defaultMenuRuntimeState(),
      recentRepos: [{ kind: 'local', id: 'C:\\Users\\user\\Developer\\repo' }],
    })
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const recentMenu = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-recent')
    expect(recentMenu?.submenu?.[0]?.label).toBe('~\\Developer\\repo')
  })

  test('keeps the shortcuts help item available when shortcuts are disabled', async () => {
    mocks.readMenuRuntimeState.mockReturnValue({
      ...defaultMenuRuntimeState(),
      shortcutsDisabled: true,
    })
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const helpMenu = mocks.template.find((entry) => entry.label === 'menu.help')
    const shortcutsItem = helpMenu?.submenu?.find((entry: any) => entry.label === 'menu.help.shortcuts')
    expect(shortcutsItem?.enabled).not.toBe(false)
    shortcutsItem.click()
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'open-settings-requested',
      page: 'shortcuts',
    })
  })

  test('routes settings from the file menu through the main window shell', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    clickMenuItem('Goblin', 'menu.app.settings')
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'open-settings-requested',
      page: 'general',
    })
  })

  test('routes appearance changes through renderer intent instead of mutating settings in main', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    clickNestedMenuItem('Goblin', 'settings.appearance', 'settings.appearance.dark')
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'theme-pref-set-requested',
      pref: 'dark',
    })
  })

  test('routes language changes through renderer intent instead of mutating settings in main', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    clickNestedMenuItem('Goblin', 'settings.lang', 'settings.lang.ko')
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'lang-pref-set-requested',
      pref: 'ko',
    })
  })

  test('wires the remote open accelerator from the file menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const remoteItem = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-remote-repo')
    expect(remoteItem?.accelerator).toBe('CmdOrCtrl+Shift+R')
  })

  test('keeps the intentional default close shortcut mapping', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const closeTabItem = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.close-tab')
    const closeWindowItem = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.close-window')
    expect(closeTabItem?.accelerator).toBe('CmdOrCtrl+Shift+W')
    expect(closeWindowItem?.accelerator).toBe('CmdOrCtrl+W')
  })

  test('wires the terminal accelerator from the view menu and removes the numbered terminal entries', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const viewMenu = mocks.template.find((entry) => entry.label === 'menu.view')
    const statusItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.status')
    const changesItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.changes')
    const terminalItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.terminal')
    const firstNumberedItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.terminal 1')
    const lastNumberedItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.terminal 7')
    const oldPrimaryItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.terminal-primary-action')

    expect(statusItem?.accelerator).toBe('CmdOrCtrl+1')
    expect(changesItem?.accelerator).toBe('CmdOrCtrl+2')
    expect(terminalItem?.accelerator).toBe('CmdOrCtrl+Enter')
    expect(firstNumberedItem).toBeUndefined()
    expect(lastNumberedItem).toBeUndefined()
    expect(oldPrimaryItem).toBeUndefined()

    terminalItem.click()
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'terminal-primary-action-requested',
    })
  })

  test('includes standard edit roles and full screen in the menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const editMenu = mocks.template.find((entry) => entry.label === 'menu.edit')
    expect(editMenu?.submenu?.map((entry: any) => entry.label)).toEqual([
      'menu.edit.undo',
      'menu.edit.redo',
      undefined,
      'menu.edit.cut',
      'menu.edit.copy',
      'menu.edit.paste',
      'menu.edit.paste-match-style',
      'menu.edit.delete',
      'menu.edit.select-all',
    ])

    const viewMenu = mocks.template.find((entry) => entry.label === 'menu.view')
    const fullScreenItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.toggle-full-screen')
    expect(fullScreenItem?.role).toBe('togglefullscreen')
  })

  test('puts native window management items before repo navigation', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const windowMenu = mocks.template.find((entry) => entry.label === 'menu.window')
    expect(windowMenu?.submenu?.slice(0, 3).map((entry: any) => entry.label)).toEqual([
      'menu.window.minimize',
      'menu.window.zoom',
      undefined,
    ])
  })

  test('reset layout resets the main window and dispatches the workspace-layout intent', async () => {
    mocks.getMainWindow.mockReturnValue(mocks.win)
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.window', 'menu.window.reset-layout')
    await Promise.resolve()

    expect(mocks.resetMainWindowToDefault).toHaveBeenCalledTimes(1)
    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'workspace-layout-reset-requested',
    })
  })

  test('routes clear recent through renderer intent', async () => {
    mocks.readMenuRuntimeState.mockReturnValue({
      ...defaultMenuRuntimeState(),
      recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
    })
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const recentMenu = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-recent')
    const clearItem = recentMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.clear-recent')
    expect(clearItem?.click).toBeTypeOf('function')
    clearItem.click()
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'clear-recent-repos-requested',
    })
  })

  test('opens the local web version from the file menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    clickMenuItem('menu.file', 'menu.file.open-in-browser')
    await Promise.resolve()

    expect(mocks.openHttpExternal).toHaveBeenCalledWith('http://127.0.0.1:32100')
  })
})

function clickMenuItem(menuLabel: string, itemLabel: string): void {
  const menu = mocks.template.find((entry) => entry.label === menuLabel)
  const item = menu?.submenu?.find((entry: any) => entry.label === itemLabel)
  expect(item?.click).toBeTypeOf('function')
  item.click()
}

function clickNestedMenuItem(menuLabel: string, parentItemLabel: string, itemLabel: string): void {
  const menu = mocks.template.find((entry) => entry.label === menuLabel)
  const parent = menu?.submenu?.find((entry: any) => entry.label === parentItemLabel)
  const item = parent?.submenu?.find((entry: any) => entry.label === itemLabel)
  expect(item?.click).toBeTypeOf('function')
  item.click()
}
