import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { app, ipcMain } from 'electron'
import { RPC_ABORT_CHANNEL, RPC_CHANNEL } from '#/shared/ipc-channels.ts'
import { getDefaultBranch, isAncestor, getCurrentBranch, getUpstream, isGitRepo } from '#/system/git/branches.ts'
import { createWorktree, getWorktrees } from '#/system/git/worktrees.ts'
import { getWorkingStatus } from '#/system/git/status.ts'
import { getWorktreePatch } from '#/system/git/patch.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'
import { getBrowserRemoteUrl, getNewPullRequestUrl, pullBranch } from '#/system/git/remote.ts'
import { getBranchPullRequest, getBranchPullRequests } from '#/system/git/pull-requests.ts'
import { openHttpsExternal } from '#/main/external-url.ts'
import { registerTrustedAppUrl, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import { broadcastRpcEvent } from '#/main/events.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import {
  addSettingsRecentRepo,
  clearSettingsRecentRepos,
  getSettingsPrefs,
  setSettingsFetchInterval,
  setSettingsGlobalShortcutState,
  getSettingsSnapshot,
  saveSettingsSession,
  updateSettingsPrefs,
} from '#/main/settings-server-facade.ts'
import { getTerminalActionAvailability, getTerminalAppAvailability, resolveTerminalApp } from '#/system/terminals.ts'
import { getEditorAppAvailability, resolveEditorApp } from '#/system/editors.ts'
import type { EditorAppState, ExternalAppsSnapshot, RpcResponse, SettingsPrefs } from '#/shared/rpc.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => Promise<unknown>>()
const browserWindowFromWebContents = vi.hoisted(() => vi.fn(() => null))
const listSshConfigHostsMock = vi.hoisted(() => vi.fn())
const resolveRemoteTargetMock = vi.hoisted(() => vi.fn())
const resolveTrackedRemoteTargetMock = vi.hoisted(() => vi.fn())
const runRemoteCommandMock = vi.hoisted(() => vi.fn())
const getEmbeddedServerRuntimeMock = vi.hoisted(() =>
  vi.fn<() => { url: string; secret: string; clientId: string } | null>(() => null),
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
  getNewPullRequestUrl: vi.fn(),
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
  setMenuWorkspaceLayout: vi.fn(),
}))

vi.mock('#/main/i18n/index.ts', () => ({
  applyLangPref: vi.fn(),
  getCurrentLang: vi.fn(() => 'en'),
  getDictionary: vi.fn(() => ({})),
  getLangPref: vi.fn(async () => 'auto'),
}))

vi.mock('#/system/terminals.ts', () => ({
  getResolvedTerminalApp: vi.fn(() => Promise.resolve(null)),
  getTerminalActionAvailability: vi.fn(() => ({ ghostty: false, terminal: true })),
  getTerminalAppAvailability: vi.fn(() => Promise.resolve({ ghostty: false, terminal: true })),
  openInPreferredTerminal: vi.fn(),
  resolveTerminalApp: vi.fn((_pref, availability) =>
    availability.ghostty ? 'ghostty' : availability.terminal ? 'terminal' : null,
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

vi.mock('#/main/events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
  sendRpcEvent: vi.fn(),
}))

vi.mock('#/main/settings-server-facade.ts', () => ({
  setSettingsFetchInterval: vi.fn(),
  setSettingsGlobalShortcutState: vi.fn(async () => true),
  getSettingsPrefs: vi.fn(async () => settingsPrefs()),
  getSettingsSnapshot: vi.fn(),
  saveSettingsSession: vi.fn(),
  updateSettingsPrefs: vi.fn(async (patch: Record<string, unknown>) => ({ ...settingsPrefs(), ...patch })),
  addSettingsRecentRepo: vi.fn(),
  clearSettingsRecentRepos: vi.fn(async () => true),
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

async function invokeRpc(
  path: string,
  input?: unknown,
  event: unknown = trustedEvent,
  requestId?: string,
): Promise<RpcResponse> {
  const handler = ipcHandlers.get(RPC_CHANNEL)
  if (!handler) throw new Error('RPC handler not wired')
  return handler(event, { path, input, requestId }) as Promise<RpcResponse>
}

async function invokeAbortRpc(input: unknown, event: unknown = trustedEvent): Promise<unknown> {
  const handler = ipcHandlers.get(RPC_ABORT_CHANNEL)
  if (!handler) throw new Error('RPC abort handler not wired')
  return handler(event, input)
}

describe('main repo rpc cancellation', () => {
  beforeAll(() => {
    registerTrustedAppUrl('http://127.0.0.1:5173/')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)
    wireRpcIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.mocked(setSettingsGlobalShortcutState).mockResolvedValue(true)
    vi.mocked(getSettingsSnapshot).mockResolvedValue(defaultSettingsSnapshot({ globalShortcut: '' }))
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
      await invokeRpc('repo.abort', { cwd: '/repo' })
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

  test('rejects RPC calls from untrusted senders', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: { id: 99 },
      senderFrame: { url: 'https://example.com/' },
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'RpcError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('rejects RPC calls without a sender frame', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: trustedSender,
      senderFrame: null,
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'RpcError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('proxies repo status reads through the embedded server when available', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      secret: 'secret',
      clientId: 'client_sharedterminal',
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ path: 'file.txt', staged: false, status: 'M' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await invokeRpc('repo.status', { cwd: '/repo' })

    expect(result).toEqual({ ok: true, data: [{ path: 'file.txt', staged: false, status: 'M' }] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        }),
        body: JSON.stringify({ cwd: '/repo' }),
      }),
    )
    expect(getWorkingStatus).not.toHaveBeenCalled()
  })

  test('proxies remote target resolution through the embedded server when available', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      secret: 'secret',
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

    const result = await invokeRpc('remote.resolveTarget', { alias: 'prod', remotePath: '/repo' })

    expect(result).toEqual({
      ok: true,
      data: {
        target: {
          id: 'ssh-config://prod/repo',
          alias: 'prod',
          host: 'example.com',
          user: 'tester',
          port: 22,
          remotePath: '/repo',
          displayName: 'prod:repo',
        },
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/resolve-target',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        }),
        body: JSON.stringify({ alias: 'prod', remotePath: '/repo' }),
      }),
    )
    expect(resolveRemoteTargetMock).not.toHaveBeenCalled()
  })

  test('fails repo RPCs when the embedded server is unavailable', async () => {
    const result = await invokeRpc('repo.deleteBranch', { cwd: '/repo', branch: 'feature/cancel' })

    expect(result).toEqual({
      ok: false,
      error: {
        name: 'RpcError',
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Embedded server unavailable',
      },
    })
  })

  test('aborts an embedded server read request by request id', async () => {
    getEmbeddedServerRuntimeMock.mockReturnValue({
      url: 'http://127.0.0.1:32100',
      secret: 'secret',
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

    const status = invokeRpc('repo.status', { cwd: '/repo' }, trustedEvent, 'rpc-read-status')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(observedSignal).toBeInstanceOf(AbortSignal)

    const aborted = await invokeAbortRpc({ requestId: 'rpc-read-status' }, trustedEvent)

    expect(aborted).toBe(true)
    await expect(status).resolves.toEqual({ ok: true, data: [] })
  })

  test('returns persistable settings without external app detection in settings.get', async () => {
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: true, terminal: true })
    vi.mocked(resolveTerminalApp).mockReturnValue('ghostty')
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: false, cursor: true, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('cursor')

    const result = await invokeRpc('settings.get')

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        theme: 'auto',
        colorTheme: 'macos',
        terminalNotificationsEnabled: false,
        terminalApp: 'auto',
        editorApp: 'auto',
      }),
    })
  })

  test('returns the embedded server settings snapshot when available', async () => {
    const snapshot = defaultSettingsSnapshot()
    vi.mocked(getSettingsSnapshot).mockResolvedValueOnce({
      ...snapshot,
      theme: 'dark',
      fetchIntervalSec: 300,
      terminalNotificationsEnabled: true,
      shortcutsDisabled: true,
      toggleDetailOnActionBarBlankClick: true,
      globalShortcutRegistered: true,
      terminalApp: 'ghostty',
      editorApp: 'cursor',
      session: {
        ...snapshot.session,
        openRepos: [{ kind: 'local', id: '/repo' }],
        activeRepo: '/repo',
      },
      recentRepos: [{ kind: 'local', id: '/repo' }],
    })

    const result = await invokeRpc('settings.get')

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
        terminalApp: 'ghostty',
        editorApp: 'cursor',
        recentRepos: [{ kind: 'local', id: '/repo' }],
      }),
    })
  })

  test('mirrors fetch interval updates from the embedded server before broadcasting', async () => {
    vi.mocked(setSettingsFetchInterval).mockResolvedValueOnce(300)

    const result = await invokeRpc('settings.setFetchInterval', { sec: 299.6 })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(setSettingsFetchInterval).toHaveBeenCalledWith(299.6)
    expect(broadcastRpcEvent).toHaveBeenCalledWith({ type: 'fetch-interval-changed', sec: 300 })
  })

  test('persists session through the embedded server', async () => {
    const session = {
      ...defaultSettingsSnapshot().session,
      openRepos: [{ kind: 'local' as const, id: '/repo' }],
      activeRepo: '/repo',
    }
    vi.mocked(saveSettingsSession).mockResolvedValueOnce(session)

    const result = await invokeRpc('settings.saveSession', { session })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(saveSettingsSession).toHaveBeenCalledWith(session)
  })

  test('adds recent repos through the embedded server before returning the list', async () => {
    const repo = { kind: 'local' as const, id: '/repo' }
    vi.mocked(addSettingsRecentRepo).mockResolvedValueOnce([repo])

    const result = await invokeRpc('settings.addRecentRepo', { repo })

    expect(result).toEqual({ ok: true, data: [repo] })
    expect(addSettingsRecentRepo).toHaveBeenCalledWith(repo)
    expect(app.addRecentDocument).toHaveBeenCalledWith('/repo')
  })

  test('clears recent repos through the embedded server', async () => {
    vi.mocked(clearSettingsRecentRepos).mockResolvedValueOnce(true)

    const result = await invokeRpc('settings.clearRecentRepos')

    expect(result).toEqual({ ok: true, data: undefined })
    expect(clearSettingsRecentRepos).toHaveBeenCalled()
    expect(app.clearRecentDocuments).toHaveBeenCalledTimes(1)
  })

  test('returns external app detection from externalApps.get', async () => {
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: true, terminal: true })
    vi.mocked(resolveTerminalApp).mockReturnValue('ghostty')
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: false, cursor: true, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('cursor')

    const result = await invokeRpc('externalApps.get')

    expect(result).toEqual({
      ok: true,
      data: {
        terminal: {
          pref: 'auto',
          resolved: 'ghostty',
          available: true,
          appAvailability: { ghostty: true, terminal: true },
          detectedAt: expect.any(Number),
        },
        editor: {
          pref: 'auto',
          resolved: 'cursor',
          available: true,
          appAvailability: { vscode: false, cursor: true, windsurf: false },
          detectedAt: expect.any(Number),
        },
      },
    })
  })

  test('assigns monotonic detectedAt values across external app snapshots in the same millisecond', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    vi.mocked(getTerminalActionAvailability).mockReturnValue({ ghostty: false, terminal: true })
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: false, terminal: false })
    vi.mocked(resolveTerminalApp).mockReturnValue('terminal')
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: true, cursor: false, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('vscode')

    try {
      const first = await invokeRpc('externalApps.get')
      const second = await invokeRpc('externalApps.refresh')

      expect(first).toEqual({
        ok: true,
        data: {
          terminal: {
            pref: 'auto',
            resolved: 'terminal',
            available: true,
            appAvailability: { ghostty: false, terminal: false },
            detectedAt: expect.any(Number),
          },
          editor: {
            pref: 'auto',
            resolved: 'vscode',
            available: true,
            appAvailability: { vscode: true, cursor: false, windsurf: false },
            detectedAt: expect.any(Number),
          },
        },
      })
      expect(second).toEqual({
        ok: true,
        data: {
          terminal: {
            pref: 'auto',
            resolved: 'terminal',
            available: true,
            appAvailability: { ghostty: false, terminal: false },
            detectedAt: expect.any(Number),
          },
          editor: {
            pref: 'auto',
            resolved: 'vscode',
            available: true,
            appAvailability: { vscode: true, cursor: false, windsurf: false },
            detectedAt: expect.any(Number),
          },
        },
      })

      if (!first.ok || !second.ok) throw new Error('expected successful RPC responses')
      const firstData = first.data as ExternalAppsSnapshot
      const secondData = second.data as ExternalAppsSnapshot
      expect(firstData.terminal.detectedAt).toBe(firstData.editor.detectedAt)
      expect(secondData.terminal.detectedAt).toBe(secondData.editor.detectedAt)
      expect(secondData.terminal.detectedAt).toBeGreaterThan(firstData.terminal.detectedAt)
    } finally {
      now.mockRestore()
    }
  })

  test('prefers embedded server prefs in external app detection snapshots', async () => {
    vi.mocked(getSettingsPrefs).mockResolvedValue(
      settingsPrefs({ terminalApp: 'terminal', editorApp: 'vscode' }),
    )
    vi.mocked(getTerminalActionAvailability).mockReturnValue({ ghostty: false, terminal: true })
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: false, terminal: false })
    vi.mocked(resolveTerminalApp).mockReturnValue('terminal')
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: true, cursor: false, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('vscode')

    const result = await invokeRpc('externalApps.get')

    expect(result).toEqual({
      ok: true,
      data: {
        terminal: expect.objectContaining({ pref: 'terminal', resolved: 'terminal' }),
        editor: expect.objectContaining({ pref: 'vscode', resolved: 'vscode' }),
      },
    })
  })

  test('broadcasts terminal app detection when the preference changes', async () => {
    vi.mocked(updateSettingsPrefs).mockResolvedValueOnce(settingsPrefs({ terminalApp: 'ghostty' }))
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: true, terminal: true })
    vi.mocked(resolveTerminalApp).mockReturnValue('ghostty')

    const result = await invokeRpc('settings.setTerminalApp', { pref: 'ghostty' })

    expect(result).toEqual({
      ok: true,
      data: {
        pref: 'ghostty',
        resolved: 'ghostty',
        available: true,
        appAvailability: { ghostty: true, terminal: true },
        detectedAt: expect.any(Number),
      },
    })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'terminal-app-changed',
      pref: 'ghostty',
      resolved: 'ghostty',
      available: true,
      appAvailability: { ghostty: true, terminal: true },
      detectedAt: expect.any(Number),
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

    const result = await invokeRpc('settings.setGlobalShortcut', { accelerator: 'Alt+K' })

    expect(result).toEqual({
      ok: true,
      data: { accelerator: 'Alt+G', registered: false },
    })
  })

  test('broadcasts terminal notification setting changes', async () => {
    vi.mocked(updateSettingsPrefs).mockResolvedValueOnce(settingsPrefs({ terminalNotificationsEnabled: true }))

    const result = await invokeRpc('settings.setTerminalNotificationsEnabled', { enabled: true })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(updateSettingsPrefs).toHaveBeenCalledWith({ terminalNotificationsEnabled: true })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'terminal-notifications-changed',
      enabled: true,
    })
  })

  test('keeps Terminal.app available for actions even when detection reports unavailable', async () => {
    vi.mocked(updateSettingsPrefs).mockResolvedValueOnce(settingsPrefs({ terminalApp: 'terminal' }))
    vi.mocked(getTerminalActionAvailability).mockReturnValue({ ghostty: false, terminal: true })
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: false, terminal: false })
    vi.mocked(resolveTerminalApp).mockReturnValue('terminal')

    const result = await invokeRpc('settings.setTerminalApp', { pref: 'terminal' })

    expect(result).toEqual({
      ok: true,
      data: {
        pref: 'terminal',
        resolved: 'terminal',
        available: true,
        appAvailability: { ghostty: false, terminal: false },
        detectedAt: expect.any(Number),
      },
    })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'terminal-app-changed',
      pref: 'terminal',
      resolved: 'terminal',
      available: true,
      appAvailability: { ghostty: false, terminal: false },
      detectedAt: expect.any(Number),
    })
  })

  test('broadcasts editor app detection when the preference changes', async () => {
    vi.mocked(updateSettingsPrefs).mockResolvedValueOnce(settingsPrefs({ editorApp: 'cursor' }))
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: false, cursor: true, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('cursor')

    const result = await invokeRpc('settings.setEditorApp', { pref: 'cursor' })

    expect(result).toEqual({
      ok: true,
      data: {
        pref: 'cursor',
        resolved: 'cursor',
        available: true,
        appAvailability: { vscode: false, cursor: true, windsurf: false },
        detectedAt: expect.any(Number),
      },
    })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'editor-app-changed',
      pref: 'cursor',
      resolved: 'cursor',
      available: true,
      appAvailability: { vscode: false, cursor: true, windsurf: false },
      detectedAt: expect.any(Number),
    })
  })

  test('assigns monotonic detectedAt values to repeated editor preference changes in the same millisecond', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000)
    vi.mocked(updateSettingsPrefs).mockResolvedValue(settingsPrefs({ editorApp: 'cursor' }))
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: false, cursor: true, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('cursor')

    try {
      const first = await invokeRpc('settings.setEditorApp', { pref: 'cursor' })
      const second = await invokeRpc('settings.setEditorApp', { pref: 'cursor' })

      expect(first).toEqual({
        ok: true,
        data: {
          pref: 'cursor',
          resolved: 'cursor',
          available: true,
          appAvailability: { vscode: false, cursor: true, windsurf: false },
          detectedAt: expect.any(Number),
        },
      })
      expect(second).toEqual({
        ok: true,
        data: {
          pref: 'cursor',
          resolved: 'cursor',
          available: true,
          appAvailability: { vscode: false, cursor: true, windsurf: false },
          detectedAt: expect.any(Number),
        },
      })

      if (!first.ok || !second.ok) throw new Error('expected successful RPC responses')
      const firstData = first.data as EditorAppState
      const secondData = second.data as EditorAppState
      expect(secondData.detectedAt).toBeGreaterThan(firstData.detectedAt)
    } finally {
      now.mockRestore()
    }
  })

  test('refreshes and broadcasts external app detection', async () => {
    vi.mocked(getTerminalAppAvailability).mockResolvedValue({ ghostty: false, terminal: true })
    vi.mocked(resolveTerminalApp).mockReturnValue('terminal')
    vi.mocked(getEditorAppAvailability).mockReturnValue({ vscode: true, cursor: false, windsurf: false })
    vi.mocked(resolveEditorApp).mockReturnValue('vscode')

    const result = await invokeRpc('externalApps.refresh')

    expect(result).toEqual({
      ok: true,
      data: {
        terminal: {
          pref: 'auto',
          resolved: 'terminal',
          available: true,
          appAvailability: { ghostty: false, terminal: true },
          detectedAt: expect.any(Number),
        },
        editor: {
          pref: 'auto',
          resolved: 'vscode',
          available: true,
          appAvailability: { vscode: true, cursor: false, windsurf: false },
          detectedAt: expect.any(Number),
        },
      },
    })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'terminal-app-changed',
      pref: 'auto',
      resolved: 'terminal',
      available: true,
      appAvailability: { ghostty: false, terminal: true },
      detectedAt: expect.any(Number),
    })
    expect(broadcastRpcEvent).toHaveBeenCalledWith({
      type: 'editor-app-changed',
      pref: 'auto',
      resolved: 'vscode',
      available: true,
      appAvailability: { vscode: true, cursor: false, windsurf: false },
      detectedAt: expect.any(Number),
    })
  })
})
