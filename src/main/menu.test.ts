import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => {
  const template: any[] = []
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
  return {
    appGetPath: vi.fn<(name: string) => string>((name: string) => (name === 'home' ? '/home/user' : '/data')),
    getShortcutsDisabled: vi.fn(() => false),
    template,
    win,
    activateMainWindow: vi.fn(() => Promise.resolve(win)),
    getFocusedWindow: vi.fn((): any => null),
    focusedRegisteredSurface: vi.fn((): any => null),
    getMainWindow: vi.fn((): any => null),
    getRecentRepos: vi.fn<() => RepoSessionEntry[]>(() => []),
    sendRpcEvent: vi.fn(),
    openSettingsWindow: vi.fn(() => Promise.resolve()),
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
}))

vi.mock('#/main/window-registry.ts', () => ({
  focusedRegisteredSurface: mocks.focusedRegisteredSurface,
}))

vi.mock('#/main/i18n/index.ts', () => ({
  applyLangPref: vi.fn(),
  t: vi.fn((key: string) => key),
}))

vi.mock('#/main/settings.ts', () => ({
  clearRecentRepos: vi.fn(),
  getLangPref: vi.fn(() => 'auto'),
  getRecentRepos: mocks.getRecentRepos,
  getSession: vi.fn(() => ({
    openRepos: [],
    activeRepo: null,
    detailCollapsed: false,
    detailFocusMode: false,
    workspaceLayout: 'top-bottom',
    detailPaneSizes: {},
  })),
  getShortcutsDisabled: mocks.getShortcutsDisabled,
  getSwapCloseShortcuts: vi.fn(() => false),
}))

vi.mock('#/main/events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
  sendRpcEvent: mocks.sendRpcEvent,
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: vi.fn(() => ({ pref: 'auto', resolved: 'light', colorTheme: 'macos' })),
  setThemePref: vi.fn(),
}))

vi.mock('#/main/settings-window.ts', () => ({
  openSettingsWindow: mocks.openSettingsWindow,
}))

describe('app menu actions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.template.length = 0
    mocks.appGetPath.mockImplementation((name: string) => (name === 'home' ? '/home/user' : '/data'))
    mocks.getShortcutsDisabled.mockReturnValue(false)
    mocks.getRecentRepos.mockReturnValue([])
    mocks.getMainWindow.mockReturnValue(null)
    mocks.getFocusedWindow.mockReturnValue(null)
    mocks.focusedRegisteredSurface.mockReturnValue(null)
    mocks.activateMainWindow.mockResolvedValue(mocks.win)
    mocks.openSettingsWindow.mockResolvedValue(undefined)
  })

  test('activates the main window before sending an action when no window exists', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo')
    await Promise.resolve()

    expect(mocks.activateMainWindow).toHaveBeenCalledTimes(1)
    expect(mocks.sendRpcEvent).toHaveBeenCalledWith(mocks.win, { type: 'menu-action', action: 'open-repo' })
  })

  test('reuses an existing main window for menu actions', async () => {
    mocks.getMainWindow.mockReturnValue(mocks.win)
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo')
    await Promise.resolve()

    expect(mocks.activateMainWindow).not.toHaveBeenCalled()
    expect(mocks.sendRpcEvent).toHaveBeenCalledWith(mocks.win, { type: 'menu-action', action: 'open-repo' })
  })

  test('sends the path dialog action from the file menu', async () => {
    mocks.getMainWindow.mockReturnValue(mocks.win)
    const { buildAppMenu } = await import('#/main/menu.ts')
    buildAppMenu()

    clickMenuItem('menu.file', 'menu.file.open-local-repo-path')
    await Promise.resolve()

    expect(mocks.sendRpcEvent).toHaveBeenCalledWith(mocks.win, { type: 'menu-action', action: 'open-repo-path' })
  })

  test('tildifies Windows home paths in the recent repos menu', async () => {
    mocks.appGetPath.mockImplementation((name: string) => (name === 'home' ? 'C:\\Users\\user' : '/data'))
    mocks.getRecentRepos.mockReturnValue([{ kind: 'local', id: 'C:\\Users\\user\\Developer\\repo' }])
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const recentMenu = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-recent')
    expect(recentMenu?.submenu?.[0]?.label).toBe('~\\Developer\\repo')
  })

  test('keeps the shortcuts help item available when shortcuts are disabled', async () => {
    mocks.getShortcutsDisabled.mockReturnValue(true)
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const helpMenu = mocks.template.find((entry) => entry.label === 'menu.help')
    const shortcutsItem = helpMenu?.submenu?.find((entry: any) => entry.label === 'menu.help.shortcuts')
    expect(shortcutsItem?.enabled).not.toBe(false)
    shortcutsItem.click()
    await Promise.resolve()

    expect(mocks.openSettingsWindow).toHaveBeenCalledWith('shortcuts')
  })

  test('opens the standalone settings window from the file menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()
    clickMenuItem('Goblin', 'menu.app.settings')
    await Promise.resolve()

    expect(mocks.openSettingsWindow).toHaveBeenCalledWith('general')
  })

  test('wires the remote open accelerator from the file menu', async () => {
    const { buildAppMenu } = await import('#/main/menu.ts')

    buildAppMenu()

    const fileMenu = mocks.template.find((entry) => entry.label === 'menu.file')
    const remoteItem = fileMenu?.submenu?.find((entry: any) => entry.label === 'menu.file.open-remote-repo')
    expect(remoteItem?.accelerator).toBe('CmdOrCtrl+Shift+R')
  })
})

function clickMenuItem(menuLabel: string, itemLabel: string): void {
  const menu = mocks.template.find((entry) => entry.label === menuLabel)
  const item = menu?.submenu?.find((entry: any) => entry.label === itemLabel)
  expect(item?.click).toBeTypeOf('function')
  item.click()
}
