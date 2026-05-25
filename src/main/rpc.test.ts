import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ipcMain } from 'electron'
import { isAncestor, getCurrentBranch, getUpstream } from '#/main/git/branches.ts'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { resolveRemovableWorktree } from '#/main/git/guards.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import type { RpcResponse } from '#/shared/rpc.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => Promise<RpcResponse>>()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: any) => Promise<RpcResponse>) => {
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
    fetchIntervalSec: 60,
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

async function invokeRpc(path: string, input?: unknown): Promise<RpcResponse> {
  const handler = ipcHandlers.get('goblin:rpc')
  if (!handler) throw new Error('RPC handler not wired')
  return handler({}, { path, input })
}

describe('main repo rpc cancellation', () => {
  beforeAll(() => {
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
})
