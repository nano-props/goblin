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
    clearRecentDocuments: vi.fn(),
    openHttpExternal: vi.fn(() => Promise.resolve(true)),
    readMenuRuntimeState: vi.fn<() => MockMenuRuntimeState>(() => defaultMenuRuntimeState()),
    template,
    win,
    activateMainWindow: vi.fn(() => Promise.resolve(win)),
    getFocusedWindow: vi.fn((): any => null),
    focusedRegisteredSurface: vi.fn((): any => null),
    getMainWindow: vi.fn((): any => null),
    sendRendererEffectIntent: vi.fn(),
    buildFromTemplate: vi.fn((nextTemplate: any[]) => {
      template.splice(0, template.length, ...nextTemplate)
      return nextTemplate
    }),
    clearSettingsRecentRepos: vi.fn(async () => true),
    setApplicationMenu: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    name: 'Goblin',
    clearRecentDocuments: mocks.clearRecentDocuments,
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
}))

vi.mock('#/main/window-registry.ts', () => ({
  focusedRegisteredSurface: mocks.focusedRegisteredSurface,
}))

vi.mock('#/main/i18n/index.ts', () => ({
  applyLangPref: vi.fn(),
  t: vi.fn((key: string) => key),
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  clearSettingsRecentRepos: mocks.clearSettingsRecentRepos,
}))

vi.mock('#/main/menu-state.ts', () => ({
  readMenuRuntimeState: mocks.readMenuRuntimeState,
  setMenuLangPref: vi.fn(),
  setMenuRecentRepos: vi.fn(),
  setMenuWorkspaceLayout: vi.fn(),
}))

vi.mock('#/main/renderer-surface-events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
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
  setThemePref: vi.fn(),
}))

describe('app menu actions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.template.length = 0
    mocks.appGetPath.mockImplementation((name: string) => (name === 'home' ? '/home/user' : '/data'))
    mocks.readMenuRuntimeState.mockReturnValue(defaultMenuRuntimeState())
    mocks.getMainWindow.mockReturnValue(null)
    mocks.getFocusedWindow.mockReturnValue(null)
    mocks.focusedRegisteredSurface.mockReturnValue(null)
    mocks.activateMainWindow.mockResolvedValue(mocks.win)
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

  test('wires the remote open accelerator from the file menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const remoteItem = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-remote-repo')
    expect(remoteItem?.accelerator).toBe('CmdOrCtrl+Shift+R')
  })

  test('wires the terminal primary action accelerator from the view menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const viewMenu = mocks.template.find((entry) => entry.label === 'menu.view')
    const terminalPrimaryItem = viewMenu?.submenu?.find((entry: any) => entry.label === 'menu.view.terminal-primary-action')
    expect(terminalPrimaryItem?.accelerator).toBe('CmdOrCtrl+Enter')

    terminalPrimaryItem.click()
    await Promise.resolve()

    expect(mocks.sendRendererEffectIntent).toHaveBeenCalledWith(mocks.win, {
      type: 'terminal-primary-action-requested',
    })
  })

  test('clears recent repos through the server-backed path and OS recent documents', async () => {
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

    expect(mocks.clearSettingsRecentRepos).toHaveBeenCalledTimes(1)
    expect(mocks.clearRecentDocuments).toHaveBeenCalledTimes(1)
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
