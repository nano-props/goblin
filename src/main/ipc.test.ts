import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { app, ipcMain } from 'electron'
import { IPC_ABORT_CHANNEL, IPC_CHANNEL } from '#/shared/ipc-channels.ts'
import { getDefaultBranch, isAncestor, getCurrentBranch, getUpstream, isGitRepo } from '#/system/git/branches.ts'
import { createWorktree, getWorktrees } from '#/system/git/worktrees.ts'
import { getWorkingStatus } from '#/system/git/status.ts'
import { getWorktreePatch } from '#/system/git/patch.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'
import { getBrowserRemoteUrl, pullBranch } from '#/system/git/remote.ts'
import { getBranchPullRequest, getBranchPullRequests } from '#/system/git/pull-requests.ts'
import { openHttpsExternal } from '#/main/external-url.ts'
import { registerTrustedAppUrl, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import { wireIpc } from '#/main/ipc.ts'
import { getSettingsPrefs } from '#/main/settings-server-client.ts'
import type { IpcResponse, SettingsPrefs } from '#/shared/api-types.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => Promise<unknown>>()
const browserWindowFromWebContents = vi.hoisted(() => vi.fn(() => null))
const listSshConfigHostsMock = vi.hoisted(() => vi.fn())
const resolveRemoteTargetMock = vi.hoisted(() => vi.fn())
const resolveTrackedRemoteTargetMock = vi.hoisted(() => vi.fn())
const runRemoteCommandMock = vi.hoisted(() => vi.fn())
const getEmbeddedServerRuntimeMock = vi.hoisted(() =>
  vi.fn<() => { url: string; accessToken: string; clientId: string } | null>(() => null),
)

function settingsPrefs(overrides: Partial<SettingsPrefs> = {}): SettingsPrefs {
  return {
    lang: 'auto',
    theme: 'auto',
    colorTheme: 'macos',
    fetchIntervalSec: 120,
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    swapCloseShortcuts: false,
    toggleDetailOnActionBarBlankClick: false,
    globalShortcut: '',
    terminalApp: 'auto',
    editorApp: 'auto',
    lanEnabled: false,
    ...overrides,
  }
}

vi.mock('electron', () => ({
  app: {
    addRecentDocument: vi.fn(),
    clearRecentDocuments: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
    fromWebContents: browserWindowFromWebContents,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: any) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('#/system/git/branches.ts', () => ({
  checkoutBranch: vi.fn(),
  deleteBranch: vi.fn(),
  getBranches: vi.fn(),
  getCurrentBranch: vi.fn(),
  getDefaultBranch: vi.fn(),
  getLog: vi.fn(),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(() => '/repo'),
  getUpstream: vi.fn(),
  isAncestor: vi.fn(),
  isGitRepo: vi.fn(),
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  createWorktree: vi.fn(),
  getWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
}))

vi.mock('#/shared/worktree-guards.ts', () => ({
  resolveKnownWorktree: vi.fn(),
  resolveRemovableWorktree: vi.fn(),
}))

vi.mock('#/system/git/helper.ts', () => ({
  checkGitAvailable: vi.fn(() => ({ ok: true })),
}))

vi.mock('#/system/git/remote.ts', () => ({
  fetchAll: vi.fn(),
  getBrowserRemoteUrl: vi.fn(),
  getRemoteInfo: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
}))

vi.mock('#/system/git/status.ts', () => ({
  getWorkingStatus: vi.fn(),
}))

vi.mock('#/system/git/patch.ts', () => ({
  getWorktreePatch: vi.fn(),
}))

vi.mock('#/system/git/clone.ts', () => ({
  cloneRepository: vi.fn(),
}))

vi.mock('#/system/git/pull-requests.ts', () => ({
  getBranchPullRequest: vi.fn(),
  getBranchPullRequests: vi.fn(),
}))

vi.mock('#/main/window.ts', () => ({
  activateMainWindow: vi.fn(() => Promise.resolve({ webContents: { send: vi.fn() } })),
  getMainWindow: vi.fn(() => null),
}))

vi.mock('#/main/window-registry.ts', () => ({
  focusedRegisteredSurface: vi.fn(() => null),
  allRegisteredSurfacesWithCapability: vi.fn(() => []),
  isRegisteredRendererSurfaceId: vi.fn(() => false),
  registeredRendererSurfaceByWebContentsId: vi.fn(() => null),
}))

vi.mock('#/main/theme.ts', () => ({
  applyThemeSettingsProjection: vi.fn(),
  getTheme: vi.fn(() => ({ pref: 'auto', resolved: 'light', colorTheme: 'macos' })),
  setColorTheme: vi.fn(),
  setThemePref: vi.fn(),
  subscribeTheme: vi.fn(),
}))

vi.mock('#/main/shortcuts.ts', () => ({
  isGlobalShortcutRegistered: vi.fn(() => false),
  replaceGlobalShortcut: vi.fn(() => true),
  syncGlobalShortcuts: vi.fn(),
}))

vi.mock('#/main/menu.ts', () => ({
  buildAppMenu: vi.fn(),
  applyMenuWorkspaceLayout: vi.fn(() => false),
}))

vi.mock('#/main/i18n/index.ts', () => ({
  applyLangPref: vi.fn(),
  getCurrentLang: vi.fn(() => 'en'),
  getDictionary: vi.fn(() => ({})),
  resolveLang: vi.fn((pref: string) => (pref === 'auto' ? 'en' : pref)),
  setCurrentLang: vi.fn(),
}))

vi.mock('#/main/menu-state.ts', () => ({
  applyMenuRuntimeState: vi.fn(),
}))

vi.mock('#/system/terminals.ts', () => ({
  getResolvedTerminalApp: vi.fn(() => Promise.resolve(null)),
  getTerminalActionAvailability: vi.fn(() => ({ ghostty: false, terminal: true, windowsTerminal: false })),
  getTerminalAppAvailability: vi.fn(() => Promise.resolve({ ghostty: false, terminal: true, windowsTerminal: false })),
  openInPreferredTerminal: vi.fn(),
  resolveTerminalApp: vi.fn((_pref, availability) =>
    availability.ghostty
      ? 'ghostty'
      : availability.terminal
        ? 'terminal'
        : availability.windowsTerminal
          ? 'windowsTerminal'
          : null,
  ),
}))

vi.mock('#/system/editors.ts', () => ({
  getResolvedEditorApp: vi.fn(() => null),
  getEditorAppAvailability: vi.fn(() => ({ vscode: false, cursor: false, windsurf: false })),
  openInPreferredEditor: vi.fn(),
  resolveEditorApp: vi.fn((_pref, availability) =>
    availability.vscode ? 'vscode' : availability.cursor ? 'cursor' : availability.windsurf ? 'windsurf' : null,
  ),
}))

vi.mock('#/main/renderer-surface-events.ts', () => ({
  broadcastIpcEvent: vi.fn(),
  sendIpcEvent: vi.fn(),
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  setSettingsGlobalShortcutState: vi.fn(async () => true),
  getSettingsPrefs: vi.fn(async () => settingsPrefs()),
  getSettingsSnapshot: vi.fn(),
  updateSettingsPrefs: vi.fn(async (patch: Record<string, unknown>) => ({ ...settingsPrefs(), ...patch })),
}))

vi.mock('#/system/github-cli.ts', () => ({
  probeGitHubCli: vi.fn(async (_signal?: AbortSignal, hosts?: string[]) => ({
    available: true,
    version: 'gh version 2.93.0',
    detectedAt: 0,
    hosts: Object.fromEntries(
      (hosts ?? ['github.com']).map((host) => [
        host,
        { host, authenticated: true, activeLogin: 'tester', logins: ['tester'], tokenSource: 'keyring' },
      ]),
    ),
  })),
}))

vi.mock('#/main/terminal.ts', () => ({
  closeWorktreeSession: vi.fn(),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: vi.fn(),
  openHttpsExternal: vi.fn(),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  listSshConfigHosts: listSshConfigHostsMock,
  resolveRemoteTarget: resolveRemoteTargetMock,
  resolveTrackedRemoteTarget: resolveTrackedRemoteTargetMock,
}))

vi.mock('#/system/ssh/commands.ts', () => ({
  runRemoteCommand: runRemoteCommandMock,
}))

vi.mock('#/main/server-manager.ts', () => ({
  getEmbeddedServerRuntime: getEmbeddedServerRuntimeMock,
}))

const trustedSender = { id: 1 }
const trustedEvent = {
  sender: trustedSender,
  senderFrame: { url: 'http://127.0.0.1:5173/?theme=light' },
}

async function invokeIpc(
  path: string,
  input?: unknown,
  event: unknown = trustedEvent,
  requestId?: string,
): Promise<IpcResponse> {
  const handler = ipcHandlers.get(IPC_CHANNEL)
  if (!handler) throw new Error('IPC handler not wired')
  return handler(event, { path, input, requestId }) as Promise<IpcResponse>
}

async function invokeAbortIpc(input: unknown, event: unknown = trustedEvent): Promise<unknown> {
  const handler = ipcHandlers.get(IPC_ABORT_CHANNEL)
  if (!handler) throw new Error('IPC abort handler not wired')
  return handler(event, input)
}

describe('main repo ipc cancellation', () => {
  beforeAll(() => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)
    wireIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    browserWindowFromWebContents.mockReturnValue(null)
    getEmbeddedServerRuntimeMock.mockReturnValue(null)
    listSshConfigHostsMock.mockResolvedValue([])
    resolveRemoteTargetMock.mockImplementation(
      async ({ alias, remotePath }: { alias: string; remotePath: string }) => ({
        target: {
          id: `ssh-config://${alias}${remotePath}`,
          alias,
          host: 'example.com',
          user: 'alice',
          port: 22,
          remotePath,
          displayName: `${alias}:repo`,
        },
      }),
    )
    resolveTrackedRemoteTargetMock.mockImplementation(async (target: any) => ({ target }))
    runRemoteCommandMock.mockResolvedValue({ ok: true, stdout: '/home/alice', stderr: '' })
    vi.mocked(isGitRepo).mockResolvedValue(true)
    vi.mocked(getCurrentBranch).mockResolvedValue('main')
    vi.mocked(getWorktrees).mockResolvedValue([{ path: '/repo', branch: 'main', isBare: false, isPrimary: true }])
    vi.mocked(getUpstream).mockResolvedValue(null)
    vi.mocked(isAncestor).mockImplementation(async () => {
      await invokeIpc('repo.abort', { cwd: '/repo' })
      return false
    })
    vi.mocked(resolveRemovableWorktree).mockReturnValue({
      ok: true,
      target: { path: '/repo-feature', branch: 'feature/cancel', isBare: false, isPrimary: false, isDirty: false },
    })
    vi.mocked(resolveKnownWorktree).mockReturnValue({
      ok: true,
      path: '/repo-feature',
    })
    vi.mocked(pullBranch).mockResolvedValue({ ok: true, message: 'ok' })
  })

  test('rejects IPC calls from untrusted senders', async () => {
    const result = await invokeIpc(
      'settings.setGlobalShortcut',
      { accelerator: 'Alt+K' },
      {
        sender: { id: 99 },
        senderFrame: { url: 'https://example.com/' },
      },
    )

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('rejects IPC calls without a sender frame', async () => {
    const result = await invokeIpc(
      'settings.setGlobalShortcut',
      { accelerator: 'Alt+K' },
      {
        sender: trustedSender,
        senderFrame: null,
      },
    )

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('returns NOT_FOUND for repo IPCs that now belong to the embedded server http path', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      clientId: 'client_sharedterminal',
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ path: 'file.txt', staged: false, status: 'M' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await invokeIpc('repo.status', { cwd: '/repo' })

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'NOT_FOUND', message: 'Unknown IPC procedure: repo.status' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getWorkingStatus).not.toHaveBeenCalled()
  })

  test('returns NOT_FOUND for remote IPCs that now belong to the embedded server http path', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      clientId: 'client_sharedterminal',
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        target: {
          id: 'ssh-config://prod/repo',
          alias: 'prod',
          host: 'example.com',
          user: 'tester',
          port: 22,
          remotePath: '/repo',
          displayName: 'prod:repo',
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await invokeIpc('remote.resolveTarget', { alias: 'prod', remotePath: '/repo' })

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'NOT_FOUND', message: 'Unknown IPC procedure: remote.resolveTarget' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveRemoteTargetMock).not.toHaveBeenCalled()
  })

  test('returns NOT_FOUND for removed business ipc procedures regardless of embedded server runtime', async () => {
    const result = await invokeIpc('repo.deleteBranch', { cwd: '/repo', branch: 'feature/cancel' })

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'NOT_FOUND', message: 'Unknown IPC procedure: repo.deleteBranch' },
    })
  })

  test('returns false when aborting a missing native ipc request id', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      clientId: 'client_sharedterminal',
    })
    let observedSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          observedSignal = init?.signal ?? undefined
          init?.signal?.addEventListener(
            'abort',
            () =>
              resolve({
                ok: true,
                json: async () => [],
              } as Response),
            { once: true },
          )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const aborted = await invokeAbortIpc({ requestId: 'ipc-read-status' }, trustedEvent)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(observedSignal).toBeUndefined()
    expect(aborted).toBe(false)
  })

  test('projects recent repos into native shell state, syncing both menu and Dock recents', async () => {
    const repo = { kind: 'local' as const, id: '/repo' }

    const result = await invokeIpc('settings.applyShellProjection', { recentRepos: { recentRepos: [repo] } })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(app.clearRecentDocuments).toHaveBeenCalledTimes(1)
    expect(app.addRecentDocument).toHaveBeenCalledWith('/repo')
  })

  test('skips remote repos when syncing Dock recent documents', async () => {
    const localRepo = { kind: 'local' as const, id: '/repo' }
    const remoteRepo = {
      kind: 'remote' as const,
      id: 'gh:owner/repo',
      ref: { id: 'gh:owner/repo', alias: 'gh', remotePath: '/owner/repo', displayName: 'gh:repo' },
    }

    const result = await invokeIpc('settings.applyShellProjection', {
      recentRepos: { recentRepos: [localRepo, remoteRepo] },
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(app.clearRecentDocuments).toHaveBeenCalledTimes(1)
    expect(app.addRecentDocument).toHaveBeenCalledTimes(1)
    expect(app.addRecentDocument).toHaveBeenCalledWith('/repo')
  })

  test('projects server-owned prefs into native shell state when the renderer updates them', async () => {
    const result = await invokeIpc('settings.applyShellProjection', {
      prefs: {
        patch: {
          lang: 'ja',
          theme: 'dark',
          colorTheme: 'github',
          shortcutsDisabled: true,
          globalShortcutDisabled: true,
          swapCloseShortcuts: true,
        },
        settings: {
          lang: 'ja',
          theme: 'dark',
          colorTheme: 'github',
          shortcutsDisabled: true,
          globalShortcutDisabled: true,
          swapCloseShortcuts: true,
          globalShortcut: 'Alt+K',
        },
      },
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect((await import('#/main/i18n/index.ts')).resolveLang).toHaveBeenCalledWith('ja')
    expect((await import('#/main/i18n/index.ts')).setCurrentLang).toHaveBeenCalledWith('ja')
    expect((await import('#/main/theme.ts')).applyThemeSettingsProjection).toHaveBeenCalledWith({
      theme: 'dark',
      colorTheme: 'github',
    })
    expect((await import('#/main/menu-state.ts')).applyMenuRuntimeState).toHaveBeenCalledWith({
      langPref: 'ja',
      shortcutsDisabled: true,
      swapCloseShortcuts: true,
    })
    expect((await import('#/main/shortcuts.ts')).syncGlobalShortcuts).toHaveBeenCalledWith(true, 'Alt+K')
    expect((await import('#/main/menu.ts')).buildAppMenu).toHaveBeenCalled()
  })

  test('rejects an empty native shell projection payload', async () => {
    const result = await invokeIpc('settings.applyShellProjection', {})

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'BAD_REQUEST', message: 'Invalid IPC input' },
    })
  })

  test('rejects recent repo projections with invalid remote paths', async () => {
    const result = await invokeIpc('settings.applyShellProjection', {
      recentRepos: {
        recentRepos: [
          {
            kind: 'remote',
            id: 'ssh-config://prodrepo',
            ref: {
              id: 'ssh-config://prodrepo',
              alias: 'prod',
              remotePath: 'repo',
              displayName: 'prod:repo',
            },
          },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'BAD_REQUEST', message: 'Invalid IPC input' },
    })
  })

  test('prefers embedded server prefs when validating a global shortcut change', async () => {
    vi.mocked(getSettingsPrefs).mockResolvedValueOnce(
      settingsPrefs({
        globalShortcut: 'Alt+G',
        globalShortcutDisabled: false,
      }),
    )
    vi.mocked((await import('#/main/shortcuts.ts')).replaceGlobalShortcut).mockReturnValueOnce(false)

    const result = await invokeIpc('settings.setGlobalShortcut', { accelerator: 'Alt+K' })

    expect(result).toEqual({
      ok: true,
      data: { accelerator: 'Alt+G', registered: false },
    })
  })

  test('returns NOT_FOUND for settings mutations that now belong to the embedded server path', async () => {
    const result = await invokeIpc('settings.setEditorApp', { pref: 'cursor' })

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'NOT_FOUND', message: 'Unknown IPC procedure: settings.setEditorApp' },
    })
  })

  test('returns NOT_FOUND for removed native namespaces like externalApps', async () => {
    const result = await invokeIpc('externalApps.get')

    expect(result).toEqual({
      ok: false,
      error: { name: 'IpcError', code: 'NOT_FOUND', message: 'Unknown IPC procedure: externalApps.get' },
    })
  })
})
