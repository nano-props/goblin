import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ipcMain } from 'electron'
import { getDefaultBranch, isAncestor, getCurrentBranch, getUpstream } from '#/main/git/branches.ts'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { getWorkingStatus } from '#/main/git/status.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/main/git/guards.ts'
import { getGitHubUrl, getPullRequestUrl, pullBranch } from '#/main/git/remote.ts'
import { getBranchPullRequest } from '#/main/git/pull-requests.ts'
import { openHttpsExternal } from '#/main/external-url.ts'
import { registerTrustedAppPath, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import type { RpcResponse } from '#/shared/rpc.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => Promise<unknown>>()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
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

vi.mock('#/main/git/branches.ts', () => ({
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

vi.mock('#/main/git/worktrees.ts', () => ({
  createWorktree: vi.fn(),
  getWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
}))

vi.mock('#/main/git/guards.ts', () => ({
  resolveKnownWorktree: vi.fn(),
  resolveRemovableWorktree: vi.fn(),
}))

vi.mock('#/main/git/helper.ts', () => ({
  checkGitAvailable: vi.fn(() => ({ ok: true })),
}))

vi.mock('#/main/git/remote.ts', () => ({
  fetchAll: vi.fn(),
  getGitHubUrl: vi.fn(),
  getPullRequestUrl: vi.fn(),
  getRemoteInfo: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
}))

vi.mock('#/main/git/status.ts', () => ({
  getWorkingStatus: vi.fn(),
}))

vi.mock('#/main/git/patch.ts', () => ({
  getWorktreePatch: vi.fn(),
}))

vi.mock('#/main/git/clone.ts', () => ({
  cloneRepository: vi.fn(),
}))

vi.mock('#/main/git/pull-requests.ts', () => ({
  getBranchPullRequest: vi.fn(),
  getBranchPullRequests: vi.fn(),
}))

vi.mock('#/main/git/log.ts', () => ({
  getCommitFileStats: vi.fn(),
  getCommitMeta: vi.fn(),
}))

vi.mock('#/main/window.ts', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('#/main/theme.ts', () => ({
  getTheme: vi.fn(() => ({ pref: 'auto', resolved: 'light', colorTheme: 'default' })),
  setColorTheme: vi.fn(),
  setThemePref: vi.fn(),
  subscribeTheme: vi.fn(),
}))

vi.mock('#/main/settings.ts', () => ({
  DEFAULT_SESSION_DETAIL_COLLAPSED: false,
  addRecentRepo: vi.fn(),
  clearRecentRepos: vi.fn(),
  getEditorApp: vi.fn(() => 'auto'),
  getTerminalApp: vi.fn(() => 'auto'),
  loadSettings: vi.fn(() => ({
    theme: 'auto',
    colorTheme: 'default',
    fetchIntervalSec: 120,
    shortcutsDisabled: false,
    globalShortcut: '',
    terminalApp: 'auto',
    editorApp: 'auto',
    lang: 'auto',
    session: {
      openRepos: [],
      activeRepo: null,
      detailCollapsed: false,
      detailFocusMode: false,
      workspaceLayout: 'branches',
      detailPaneSizes: {},
    },
    recentRepos: [],
  })),
  onSettingsWriteError: vi.fn(),
  setEditorApp: vi.fn(),
  setFetchInterval: vi.fn(),
  setGlobalShortcut: vi.fn(),
  setSession: vi.fn(),
  setShortcutsDisabled: vi.fn(),
  setTerminalApp: vi.fn(),
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
}))

vi.mock('#/main/system/terminals.ts', () => ({
  getResolvedTerminalApp: vi.fn(() => null),
  openInPreferredTerminal: vi.fn(),
}))

vi.mock('#/main/system/editors.ts', () => ({
  getResolvedEditorApp: vi.fn(() => null),
  openInPreferredEditor: vi.fn(),
}))

vi.mock('#/main/events.ts', () => ({
  broadcastRpcEvent: vi.fn(),
}))

vi.mock('#/main/terminal.ts', () => ({
  closeWorktreeSession: vi.fn(),
}))

vi.mock('#/main/external-url.ts', () => ({
  openHttpExternal: vi.fn(),
  openHttpsExternal: vi.fn(),
}))

const trustedSender = { id: 1 }
const trustedEvent = {
  sender: trustedSender,
  senderFrame: { url: 'file:///app/dist/renderer/index.html?theme=light' },
}

async function invokeRpc(
  path: string,
  input?: unknown,
  event: unknown = trustedEvent,
  requestId?: string,
): Promise<RpcResponse> {
  const handler = ipcHandlers.get('goblin:rpc')
  if (!handler) throw new Error('RPC handler not wired')
  return handler(event, { path, input, requestId }) as Promise<RpcResponse>
}

async function invokeAbortRpc(input: unknown, event: unknown = trustedEvent): Promise<unknown> {
  const handler = ipcHandlers.get('goblin:rpc-abort')
  if (!handler) throw new Error('RPC abort handler not wired')
  return handler(event, input)
}

describe('main repo rpc cancellation', () => {
  beforeAll(() => {
    registerTrustedAppPath('/app/dist/renderer/index.html')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)
    wireRpcIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
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

  test('returns cancelled when deleteBranch is aborted during safety checks', async () => {
    const result = await invokeRpc('repo.deleteBranch', { cwd: '/repo', branch: 'feature/cancel' })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
  })

  test('returns cancelled when removeWorktree is aborted during safety checks', async () => {
    const result = await invokeRpc('repo.removeWorktree', {
      cwd: '/repo',
      branch: 'feature/cancel',
      worktreePath: '/repo-feature',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
  })

  test('returns cancelled when pull is aborted while resolving a worktree target', async () => {
    vi.mocked(getWorktrees).mockImplementationOnce(async () => {
      await invokeRpc('repo.abort', { cwd: '/repo' })
      return [{ path: '/repo-feature', branch: 'feature/cancel', isBare: false, isPrimary: false, isDirty: false }]
    })

    const result = await invokeRpc('repo.pull', {
      cwd: '/repo',
      branch: 'feature/cancel',
      worktreePath: '/repo-feature',
    })

    expect(result).toEqual({ ok: true, data: { ok: false, message: 'cancelled' } })
    expect(resolveKnownWorktree).not.toHaveBeenCalled()
    expect(pullBranch).not.toHaveBeenCalled()
  })

  test('rejects RPC calls from untrusted senders', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: { id: 99 },
      senderFrame: { url: 'https://example.com/' },
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'TRPCError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('rejects RPC calls without a sender frame', async () => {
    const result = await invokeRpc('settings.get', undefined, {
      sender: trustedSender,
      senderFrame: null,
    })

    expect(result).toEqual({
      ok: false,
      error: { name: 'TRPCError', code: 'FORBIDDEN', message: 'Untrusted IPC sender' },
    })
  })

  test('aborts a cancellable read RPC by request id', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(getWorkingStatus).mockImplementation(
      (_cwd, options) =>
        new Promise((resolve) => {
          observedSignal = options?.signal
          options?.signal?.addEventListener('abort', () => resolve([{ path: '/repo', isMain: true, entries: [] }]), {
            once: true,
          })
        }),
    )

    const status = invokeRpc('repo.status', { cwd: '/repo' }, trustedEvent, 'rpc-read-status')
    await vi.waitFor(() => expect(getWorkingStatus).toHaveBeenCalled())
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    const aborted = await invokeAbortRpc({ requestId: 'rpc-read-status' }, trustedEvent)

    expect(aborted).toBe(true)
    await expect(status).resolves.toEqual({ ok: true, data: [] })
    expect(getWorkingStatus).toHaveBeenCalledWith('/repo', { signal: expect.any(AbortSignal) })
  })

  test('passes branch context when opening a default branch GitHub URL', async () => {
    vi.mocked(getDefaultBranch).mockResolvedValue('main')
    vi.mocked(getBranchPullRequest).mockResolvedValue(null)
    vi.mocked(getGitHubUrl).mockResolvedValue('https://github.com/acme/repo')
    vi.mocked(openHttpsExternal).mockResolvedValue(true)

    const result = await invokeRpc('repo.openGitHub', { cwd: '/repo', branch: 'main' })

    expect(result).toEqual({ ok: true, data: { ok: true, message: 'https://github.com/acme/repo' } })
    expect(getPullRequestUrl).not.toHaveBeenCalled()
    expect(getGitHubUrl).toHaveBeenCalledWith('/repo', { branch: 'main' })
  })

  test('returns null when snapshot is aborted during worktree loading', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(getWorktrees).mockImplementation(
      (_cwd, options) =>
        new Promise((_resolve, reject) => {
          observedSignal = options?.signal
          options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        }),
    )

    const snapshot = invokeRpc('repo.snapshot', { cwd: '/repo' }, trustedEvent, 'rpc-read-snapshot')
    await vi.waitFor(() => expect(getWorktrees).toHaveBeenCalled())
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    const aborted = await invokeAbortRpc({ requestId: 'rpc-read-snapshot' }, trustedEvent)

    expect(aborted).toBe(true)
    await expect(snapshot).resolves.toEqual({ ok: true, data: null })
  })
})
