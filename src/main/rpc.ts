import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { TRPCError } from '@trpc/server'
import {
  createAppRouter,
  type AppRpcHandlers,
  type NetworkOpKind,
  type RpcRequest,
  type RpcResponse,
  type SessionState,
  type SettingsSnapshot,
  type TerminalAppState,
  type EditorAppState,
  type EditorPref,
  type TerminalPref,
} from '#/shared/rpc.ts'
import {
  checkoutBranch,
  deleteBranch,
  getBranches,
  getCurrentBranch,
  getDefaultBranch,
  getLog,
  getRepoName,
  getRepoRoot,
  getUpstream,
  isAncestor,
  isGitRepo,
} from '#/main/git/branches.ts'
import { fetchAll, getGitHubUrl, getPullRequestUrl, pullBranch, pushBranch } from '#/main/git/remote.ts'
import { getWorkingStatus } from '#/main/git/status.ts'
import { getWorktreePatch } from '#/main/git/patch.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/main/git/guards.ts'
import { createWorktree, getWorktrees, removeWorktree } from '#/main/git/worktrees.ts'
import { cloneRepository } from '#/main/git/clone.ts'
import { getBranchPullRequest, getBranchPullRequests } from '#/main/git/pull-requests.ts'
import { getCommitFileStats, getCommitMeta } from '#/main/git/log.ts'
import {
  GIT_HASH_RE,
  PROTECTED_BRANCHES,
  branchPullRequestBelongsToBranch,
  type ExecResult,
  type PullRequestFetchMode,
} from '#/shared/git-types.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { checkGitAvailable } from '#/main/git/helper.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd, isValidOptionalBranch } from '#/main/ipc/validation.ts'
import { getMainWindow } from '#/main/window.ts'
import { getTheme, setColorTheme, setThemePref, subscribeTheme } from '#/main/theme.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  DEFAULT_SESSION_DETAIL_COLLAPSED,
  loadSettings,
  onSettingsWriteError,
  setFetchInterval,
  setGlobalShortcut,
  setSession,
  setShortcutsDisabled,
  setTerminalApp,
  getTerminalApp,
  setEditorApp,
  getEditorApp,
} from '#/main/settings.ts'
import {
  effectiveDetailCollapsed,
  normalizeDetailPaneSizes,
  normalizeWorkspaceLayout,
} from '#/shared/workspace-layout.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut, syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { buildAppMenu, setMenuWorkspaceLayout } from '#/main/menu.ts'
import { applyLangPref, getCurrentLang, getDictionary } from '#/main/i18n/index.ts'
import { getResolvedTerminalApp, openInPreferredTerminal } from '#/main/system/terminals.ts'
import { getResolvedEditorApp, openInPreferredEditor } from '#/main/system/editors.ts'
import { broadcastRpcEvent } from '#/main/events.ts'
import { closeWorktreeSession } from '#/main/terminal.ts'
import { openHttpExternal, openHttpsExternal } from '#/main/external-url.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'

const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'
const PATCH_TIMEOUT_MS = 90_000
const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/
const CLONE_OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const MAX_RPC_PROCEDURE_PATH_LENGTH = 128
const MAX_RPC_REQUEST_ID_LENGTH = 128
const RPC_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const RPC_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_RPC_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  done: Promise<void>
}

interface ActiveCloneOp {
  ctrl: AbortController
  done: Promise<void>
}

const activeOpControllers = new Map<string, ActiveNetworkOp>()
const activeCloneControllers = new Map<string, ActiveCloneOp>()
const activeRpcControllers = new Map<string, AbortController>()
const rpcSignalStorage = new AsyncLocalStorage<AbortSignal>()

let wired = false

type TerminalAppSnapshot = Pick<SettingsSnapshot, 'terminalApp' | 'resolvedTerminalApp' | 'terminalAvailable'>
type EditorAppSnapshot = Pick<SettingsSnapshot, 'editorApp' | 'resolvedEditorApp' | 'editorAvailable'>

export function wireRpcIpc(): void {
  if (wired) return
  wired = true

  const router = createAppRouter(createRpcHandlers())

  ipcMain.handle('goblin:rpc-abort', async (event, input: unknown): Promise<boolean> => {
    try {
      return isTrustedIpcEvent(event) ? abortRpcRequest(input) : false
    } catch {
      return false
    }
  })

  ipcMain.handle('goblin:rpc', async (event, request: RpcRequest): Promise<RpcResponse> => {
    try {
      if (!isTrustedIpcEvent(event)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Untrusted IPC sender' })
      }
      if (!isValidRpcRequest(request)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid RPC request' })
      }
      const caller = router.createCaller({})
      const procedure = request.path.split('.').reduce<unknown>(resolveRpcPathSegment, caller)
      if (typeof procedure !== 'function') {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown RPC procedure: ${request.path}` })
      }
      const requestId = request.requestId
      if (!isValidRpcRequestId(requestId)) return { ok: true, data: await procedure(request.input) }
      const ctrl = new AbortController()
      activeRpcControllers.set(requestId, ctrl)
      try {
        const data = await rpcSignalStorage.run(ctrl.signal, () => procedure(request.input))
        return { ok: true, data }
      } finally {
        if (activeRpcControllers.get(requestId) === ctrl) activeRpcControllers.delete(requestId)
      }
    } catch (err) {
      return { ok: false, error: toRpcError(err) }
    }
  })

  subscribeTheme((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setBackgroundColor(WINDOW_BACKGROUND_BY_COLOR_THEME[state.colorTheme][state.resolved])
    }
    buildAppMenu()
    broadcastRpcEvent({ type: 'theme-changed', state })
  })

  onSettingsWriteError((err) => {
    const message = err instanceof Error ? err.message : String(err)
    broadcastRpcEvent({ type: 'settings-write-error', message })
  })
}

function isValidRpcRequest(request: unknown): request is RpcRequest {
  if (!request || typeof request !== 'object') return false
  const { path } = request as { path?: unknown }
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_RPC_PROCEDURE_PATH_LENGTH) return false
  const segments = path.split('.')
  if (segments.some((segment) => segment.length === 0)) return false
  if (!segments.every((segment) => RPC_PATH_SEGMENT_RE.test(segment) && !FORBIDDEN_RPC_PATH_SEGMENTS.has(segment))) {
    return false
  }
  return true
}

function isValidRpcRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RPC_REQUEST_ID_LENGTH &&
    RPC_REQUEST_ID_RE.test(value)
  )
}

function abortRpcRequest(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const { requestId } = input as { requestId?: unknown }
  if (!isValidRpcRequestId(requestId)) return false
  const ctrl = activeRpcControllers.get(requestId)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

function currentRpcSignal(): AbortSignal | undefined {
  return rpcSignalStorage.getStore()
}

function resolveRpcPathSegment(target: unknown, segment: string): unknown {
  if (FORBIDDEN_RPC_PATH_SEGMENTS.has(segment)) return undefined
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return undefined
  return (target as Record<string, unknown>)[segment]
}

function toRpcError(err: unknown): Extract<RpcResponse, { ok: false }>['error'] {
  if (err instanceof TRPCError) return { name: err.name, code: err.code, message: err.message }
  if (err instanceof Error) return { name: err.name, message: err.message }
  return { message: String(err) }
}

function terminalAppState(pref: TerminalPref): TerminalAppState {
  const resolved = getResolvedTerminalApp(pref)
  return { pref, resolved, available: resolved !== null }
}

function editorAppState(pref: EditorPref): EditorAppState {
  const resolved = getResolvedEditorApp(pref)
  return { pref, resolved, available: resolved !== null }
}

function terminalAppSnapshot(pref: TerminalPref): TerminalAppSnapshot {
  const state = terminalAppState(pref)
  return {
    terminalApp: state.pref,
    resolvedTerminalApp: state.resolved,
    terminalAvailable: state.available,
  }
}

function editorAppSnapshot(pref: EditorPref): EditorAppSnapshot {
  const state = editorAppState(pref)
  return {
    editorApp: state.pref,
    resolvedEditorApp: state.resolved,
    editorAvailable: state.available,
  }
}

function createRpcHandlers(): AppRpcHandlers {
  return {
    app: {
      openProjectGitHub: async () => {
        if (!(await openHttpsExternal(PROJECT_GITHUB_URL))) return { ok: false, message: 'error.invalid-url' }
        return { ok: true, message: PROJECT_GITHUB_URL }
      },
      openExternalUrl: async ({ url }) => {
        if (!(await openHttpExternal(url))) return { ok: false, message: 'error.invalid-url' }
        return { ok: true, message: url }
      },
    },
    repo: {
      openDialog: openRepoDialog,
      cloneParentDialog: () => openDirectoryDialog('Choose Clone Destination'),
      probe: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-path' }
        const gitAvailable = await checkGitAvailable()
        if (!gitAvailable.ok) return gitAvailable
        const readable = await probeReadableDirectory(cwd)
        if (!readable.ok) return readable
        const ok = await isGitRepo(cwd)
        if (!ok) return { ok: false, message: 'error.not-git-repo' }
        const root = await getRepoRoot(cwd)
        if (!root) return { ok: false, message: 'error.failed-read-repo' }
        const name = await getRepoName(cwd)
        return { ok: true, root, name }
      },
      clone: async ({ operationId, url, parentPath, directoryName }) => {
        if (!isValidCloneOperationId(operationId)) return { ok: false, message: 'error.invalid-arguments' }
        const repoUrl = typeof url === 'string' ? url.trim() : ''
        const targetParent = typeof parentPath === 'string' ? parentPath.trim() : ''
        const targetName = typeof directoryName === 'string' ? directoryName.trim() : ''
        if (!isValidCloneUrl(repoUrl) || !isValidCloneDirectoryName(targetName)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        if (!isValidAbsolutePath(targetParent)) return { ok: false, message: 'error.invalid-path' }
        const gitAvailable = await checkGitAvailable()
        if (!gitAvailable.ok) return gitAvailable
        const writable = await ensureWritableDirectory(targetParent)
        if (!writable.ok) return writable
        return runCloneOperation(operationId, (signal) => cloneRepository(targetParent, targetName, repoUrl, signal))
      },
      abortClone: async ({ operationId }) => abortCloneOperation(operationId),
      snapshot: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return null
        const signal = currentRpcSignal()
        try {
          const worktrees = await getWorktrees(cwd, { signal })
          if (signal?.aborted) return null
          const branches = await getBranches(cwd, worktrees, { signal })
          if (signal?.aborted) return null
          const current = await getCurrentBranch(cwd, { signal })
          if (signal?.aborted) return null
          return { branches, current }
        } catch (err) {
          if (signal?.aborted) return null
          throw err
        }
      },
      pullRequests: async ({ cwd, branches, options }) => {
        if (!isValidCwd(cwd)) return null
        if (branches !== undefined && !Array.isArray(branches)) return null
        const mode: PullRequestFetchMode = options?.mode === 'summary' ? 'summary' : 'full'
        const branchSet =
          branches === undefined
            ? undefined
            : new Set(
                branches.filter((branch): branch is string => {
                  return isValidBranch(branch)
                }),
              )
        if (branchSet?.size === 0) return []
        const signal = currentRpcSignal()
        const prs = await getBranchPullRequests(cwd, branchSet, { mode, signal })
        if (!prs) return null
        return Array.from(prs, ([branch, pullRequest]) => ({ branch, pullRequest }))
      },
      log: async ({ cwd, branch, count, skip }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return []
        const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 100
        const safeCount = Math.max(1, Math.min(1000, n))
        const offset = typeof skip === 'number' && Number.isFinite(skip) ? Math.floor(skip) : 0
        const safeSkip = Math.max(0, offset)
        const signal = currentRpcSignal()
        const log = await getLog(cwd, branch, safeCount, safeSkip, { signal })
        return signal?.aborted ? [] : log
      },
      status: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return []
        const signal = currentRpcSignal()
        const status = await getWorkingStatus(cwd, { signal })
        return signal?.aborted ? [] : status
      },
      patch: createPatch,
      commit: async ({ cwd, hash }) => {
        if (!isValidCwd(cwd) || typeof hash !== 'string' || !hash) return null
        if (!GIT_HASH_RE.test(hash)) return null
        const [meta, files] = await Promise.all([getCommitMeta(cwd, hash), getCommitFileStats(cwd, hash)])
        if (!meta) return null
        return { meta, files }
      },
      checkout: async ({ cwd, branch }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, 'user', (signal) => checkoutBranch(cwd, branch, signal))
      },
      deleteBranch: async (input) => {
        if (!isValidCwd(input.cwd) || !isValidBranch(input.branch)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        return runCancellable(input.cwd, 'user', (signal) => deleteRepoBranch(input, signal))
      },
      removeWorktree: async (input) => {
        if (
          !isValidCwd(input.cwd) ||
          !isValidBranch(input.branch) ||
          !isValidAbsolutePath(input.worktreePath) ||
          typeof input.alsoDeleteBranch !== 'boolean' ||
          (input.forceDeleteBranch !== undefined && typeof input.forceDeleteBranch !== 'boolean')
        ) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        return runCancellable(input.cwd, 'user', (signal) => removeRepoWorktree(input, signal))
      },
      createWorktree: async ({ cwd, worktreePath, newBranch, baseBranch }) => {
        if (!isValidCwd(cwd) || !isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
        return runCancellable(cwd, 'user', (signal) => createWorktree(cwd, worktreePath, newBranch, baseBranch, signal))
      },
      pull: async ({ cwd, branch, worktreePath }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        if (worktreePath !== undefined && !isValidAbsolutePath(worktreePath)) {
          return { ok: false, message: 'error.invalid-worktree-path' }
        }
        return runCancellable(cwd, 'user', async (signal) => {
          let targetPath: string | undefined
          if (worktreePath !== undefined) {
            let worktrees
            try {
              worktrees = await getWorktrees(cwd, { signal })
            } catch (err) {
              if (signal.aborted) return { ok: false, message: 'cancelled' }
              throw err
            }
            const target = resolveKnownWorktree(worktrees, worktreePath, branch)
            if (!target.ok) return target
            targetPath = target.path
          }
          return pullBranch(cwd, branch, targetPath, signal)
        })
      },
      push: async ({ cwd, branch }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, 'user', (signal) => pushBranch(cwd, branch, signal))
      },
      fetch: async ({ cwd, kind }) => {
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, kind === 'background' ? 'background' : 'user', (signal) => fetchAll(cwd, signal))
      },
      abort: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return false
        const ctrl = activeOpControllers.get(cwd)
        if (!ctrl) return false
        ctrl.ctrl.abort()
        return true
      },
      openGitHub: openRepoGitHub,
      openInFinder: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        shell.showItemInFolder(p)
        return { ok: true, message: p }
      },
      openTerminal: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInPreferredTerminal(p, getTerminalApp())
      },
      openEditor: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInPreferredEditor(p, getEditorApp()) ?? { ok: false, message: 'error.editor-not-installed' }
      },
    },
    theme: {
      get: () => getTheme(),
      setPref: async ({ pref }) => {
        if (pref !== 'auto' && pref !== 'light' && pref !== 'dark') return getTheme()
        return setThemePref(pref)
      },
      setColorTheme: async ({ colorTheme }) => setColorTheme(colorTheme),
    },
    settings: {
      get: async () => {
        const s = await loadSettings()
        return {
          theme: s.theme,
          colorTheme: s.colorTheme,
          fetchIntervalSec: s.fetchIntervalSec,
          shortcutsDisabled: s.shortcutsDisabled,
          globalShortcut: s.globalShortcut,
          globalShortcutRegistered: isGlobalShortcutRegistered(),
          ...terminalAppSnapshot(s.terminalApp),
          ...editorAppSnapshot(s.editorApp),
          session: s.session,
          recentRepos: s.recentRepos,
        }
      },
      setFetchInterval: async ({ sec }) => {
        if (!Number.isFinite(sec)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid fetch interval' })
        const clamped = await setFetchInterval(sec)
        broadcastRpcEvent({ type: 'fetch-interval-changed', sec: clamped })
      },
      setShortcutsDisabled: async ({ disabled }) => {
        if (typeof disabled !== 'boolean') return
        const saved = await setShortcutsDisabled(disabled)
        const s = await loadSettings()
        syncGlobalShortcuts(saved, s.globalShortcut)
        buildAppMenu()
        broadcastRpcEvent({ type: 'shortcuts-disabled-changed', disabled: saved })
        broadcastRpcEvent({ type: 'global-shortcut-changed', state: globalShortcutPayload(s.globalShortcut) })
      },
      setGlobalShortcut: async ({ accelerator }) => {
        const parsed = parseGlobalShortcut(accelerator)
        const s = await loadSettings()
        if (!parsed) return globalShortcutPayload(s.globalShortcut)
        if (isReservedGlobalShortcut(parsed)) return globalShortcutPayload(s.globalShortcut)
        const registered = s.shortcutsDisabled || replaceGlobalShortcut(false, s.globalShortcut, parsed)
        if (!registered && !s.shortcutsDisabled) return globalShortcutPayload(s.globalShortcut)
        const saved = await setGlobalShortcut(parsed)
        const payload = globalShortcutPayload(saved)
        broadcastRpcEvent({ type: 'global-shortcut-changed', state: payload })
        return payload
      },
      setTerminalApp: async ({ pref }) => {
        const saved = await setTerminalApp(pref)
        const payload = terminalAppState(saved)
        broadcastRpcEvent({ type: 'terminal-app-changed', ...payload })
        return payload
      },
      setEditorApp: async ({ pref }) => {
        const saved = await setEditorApp(pref)
        const payload = editorAppState(saved)
        broadcastRpcEvent({ type: 'editor-app-changed', ...payload })
        return payload
      },
      saveSession: async ({ session }) => saveSession(session),
      addRecentRepo: async ({ repoPath }) => {
        if (typeof repoPath !== 'string') return []
        const recentRepos = await addRecentRepo(repoPath)
        buildAppMenu()
        return recentRepos
      },
      clearRecentRepos: async () => {
        await clearRecentRepos()
        buildAppMenu()
      },
    },
    i18n: {
      get: async () => {
        const settings = await loadSettings()
        return {
          lang: getCurrentLang(),
          pref: settings.lang,
          dict: getDictionary(),
        }
      },
      setPref: async ({ pref }) => {
        if (pref !== 'auto' && pref !== 'en' && pref !== 'zh' && pref !== 'ko' && pref !== 'ja') return null
        const payload = await applyLangPref(pref)
        if (!payload) return null
        buildAppMenu()
        broadcastRpcEvent({ type: 'i18n-changed', payload })
        return payload
      },
    },
  }
}

async function openRepoDialog(): Promise<string | null> {
  return openDirectoryDialog('Open Git Repository')
}

async function openDirectoryDialog(title: string): Promise<string | null> {
  const win = getMainWindow() ?? BrowserWindow.getFocusedWindow()
  const opts: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
    title,
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function deleteRepoBranch(
  {
    cwd,
    branch,
    force,
  }: {
    cwd: string
    branch: string
    force?: boolean
  },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
  const current = await getCurrentBranch(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (branch === current) return { ok: false, message: 'error.cannot-delete-current-branch' }
  if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
  const worktrees = await getWorktrees(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (worktrees.some((wt) => wt.branch === branch)) {
    return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
  }
  const shouldForce = force === true
  const safelyDeletable = shouldForce || (await isSafelyDeletableBranch(cwd, branch, signal))
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!safelyDeletable) {
    return { ok: false, message: 'error.branch-not-fully-merged' }
  }
  return deleteBranch(cwd, branch, { force: shouldForce, signal })
}

async function removeRepoWorktree(
  {
    cwd,
    branch,
    worktreePath,
    alsoDeleteBranch,
    forceDeleteBranch,
  }: {
    cwd: string
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
  },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (
    !isValidCwd(cwd) ||
    !isValidBranch(branch) ||
    !isValidAbsolutePath(worktreePath) ||
    typeof alsoDeleteBranch !== 'boolean' ||
    (forceDeleteBranch !== undefined && typeof forceDeleteBranch !== 'boolean')
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = await getRepoRoot(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const worktrees = await getWorktrees(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const resolved = resolveRemovableWorktree(worktrees, branch, worktreePath, root)
  if (!resolved.ok) return resolved
  const target = resolved.target

  if (target.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  // `isDirty` is undefined when the status probe failed; only an explicit
  // false is safe enough to remove a worktree.
  if (target.isDirty !== false) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }

  const shouldForceDeleteBranch = forceDeleteBranch === true
  if (alsoDeleteBranch) {
    if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    const safelyDeletable = shouldForceDeleteBranch || (await isSafelyDeletableBranch(cwd, branch, signal))
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!safelyDeletable) {
      return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
    }
  }

  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const removeResult = await removeWorktree(cwd, target.path, signal)
  if (!removeResult.ok) return removeResult
  closeWorktreeSession(root, target.path)
  if (alsoDeleteBranch) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    const delResult = await deleteBranch(cwd, branch, { force: shouldForceDeleteBranch, signal })
    if (!delResult.ok) return delResult
  }
  return removeResult
}

async function createPatch({ cwd, worktreePath }: { cwd: string; worktreePath: string }): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidAbsolutePath(worktreePath))
    return { ok: false, message: 'error.invalid-worktree-path' }
  const ctrl = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, PATCH_TIMEOUT_MS)
  if ('unref' in timeout && typeof timeout.unref === 'function') timeout.unref()
  try {
    const target = resolveKnownWorktree(
      await getWorktrees(cwd, { includeStatus: false, signal: ctrl.signal }),
      worktreePath,
    )
    if (!target.ok) return target
    const patch = await getWorktreePatch(target.path, { signal: ctrl.signal })
    if (timedOut) return { ok: false, message: `git timed out after ${PATCH_TIMEOUT_MS / 1000}s` }
    if (ctrl.signal.aborted) return { ok: false, message: 'cancelled' }
    return { ok: true, message: patch }
  } catch (err: unknown) {
    // Timeout aborts surface as thrown git errors, so check the timeout
    // flag before the generic aborted/error paths.
    if (timedOut) return { ok: false, message: `git timed out after ${PATCH_TIMEOUT_MS / 1000}s` }
    if (ctrl.signal.aborted) return { ok: false, message: 'cancelled' }
    const e = err as { stderr?: string; message?: string }
    const msg = (typeof e.stderr === 'string' && e.stderr.trim()) || e.message || 'error.unknown'
    return { ok: false, message: msg }
  } finally {
    clearTimeout(timeout)
  }
}

async function openRepoGitHub({ cwd, branch }: { cwd: string; branch?: string }): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidOptionalBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
  // Only branch opens need the default branch: it tells us whether a PR is a
  // reverse/default-branch PR that should not be opened from the default row.
  const defaultBranch = branch ? await getDefaultBranch(cwd) : ''
  const isDefaultBranch = !!defaultBranch && branch === defaultBranch
  if (branch) {
    const detectedPr = await getBranchPullRequest(cwd, branch)
    if (
      detectedPr?.url &&
      branchPullRequestBelongsToBranch({ name: branch, isDefault: isDefaultBranch }, detectedPr) &&
      (await openHttpsExternal(detectedPr.url))
    ) {
      return { ok: true, message: detectedPr.url }
    }
  }
  if (typeof branch === 'string' && branch && !isDefaultBranch) {
    const prUrl = await getPullRequestUrl(cwd, branch)
    if (prUrl && (await openHttpsExternal(prUrl))) return { ok: true, message: prUrl }
  }
  const url = await getGitHubUrl(cwd)
  if (!url) return { ok: false, message: 'error.open-github-no-origin' }
  if (!(await openHttpsExternal(url))) return { ok: false, message: 'error.invalid-url' }
  return { ok: true, message: url }
}

async function isSafelyDeletableBranch(cwd: string, branch: string, signal?: AbortSignal): Promise<boolean> {
  const upstream = await getUpstream(cwd, branch, signal)
  return isAncestor(cwd, branch, upstream ?? 'HEAD', signal)
}

async function runCancellable(
  repoId: string,
  kind: NetworkOpKind,
  fn: (signal: AbortSignal) => Promise<ExecResult>,
): Promise<ExecResult> {
  let active = activeOpControllers.get(repoId)
  if (active) {
    if (kind === 'user' && active.kind === 'background') {
      active.ctrl.abort()
      await active.done
      active = activeOpControllers.get(repoId)
    }
    if (active) return { ok: false, message: 'error.network-op-in-progress' }
  }

  const ctrl = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const slot: ActiveNetworkOp = { ctrl, kind, done }
  activeOpControllers.set(repoId, slot)
  try {
    return await fn(ctrl.signal)
  } finally {
    if (activeOpControllers.get(repoId) === slot) activeOpControllers.delete(repoId)
    resolveDone()
  }
}

async function runCloneOperation(
  operationId: string,
  fn: (signal: AbortSignal) => Promise<ExecResult & { path?: string }>,
): Promise<ExecResult & { path?: string }> {
  if (activeCloneControllers.has(operationId)) return { ok: false, message: 'error.network-op-in-progress' }
  const ctrl = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const slot: ActiveCloneOp = { ctrl, done }
  activeCloneControllers.set(operationId, slot)
  try {
    return await fn(ctrl.signal)
  } finally {
    if (activeCloneControllers.get(operationId) === slot) activeCloneControllers.delete(operationId)
    resolveDone()
  }
}

function abortCloneOperation(operationId: string): boolean {
  if (!isValidCloneOperationId(operationId)) return false
  const active = activeCloneControllers.get(operationId)
  if (!active) return false
  active.ctrl.abort()
  return true
}

async function probeReadableDirectory(cwd: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fs.constants.R_OK)
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, message: 'error.path-not-found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, message: 'error.path-permission-denied' }
    return { ok: false, message: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
}

async function probeWritableDirectory(cwd: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fs.constants.R_OK | fs.constants.W_OK)
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, message: 'error.path-not-found' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, message: 'error.path-permission-denied' }
    return { ok: false, message: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
}

async function ensureWritableDirectory(cwd: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await fs.mkdir(cwd, { recursive: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, message: 'error.path-permission-denied' }
    return { ok: false, message: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
  return probeWritableDirectory(cwd)
}

function isValidCloneUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_URL_LENGTH &&
    !/[\0-\x1f\x7f]/.test(value) &&
    (CLONE_URL_SCHEME_RE.test(value) || SCP_LIKE_CLONE_URL_RE.test(value))
  )
}

function isValidCloneDirectoryName(value: unknown): value is string {
  // Only reject names that can change the path shape. Names like `...`
  // or `-repo` are valid single folder names; git receives the full
  // target path after `--`, so they are not parsed as traversal or flags.
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_DIR_NAME_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/:\0]/.test(value)
  )
}

function isValidCloneOperationId(value: unknown): value is string {
  return typeof value === 'string' && CLONE_OPERATION_ID_RE.test(value)
}

async function saveSession(session: SessionState): Promise<void> {
  if (!session || !Array.isArray(session.openRepos)) return
  const openRepos = session.openRepos.map(toSafeSessionPath).filter((p): p is string => p !== null)
  const activeRepo = toSafeSessionPath(session.activeRepo)
  const workspaceLayout = normalizeWorkspaceLayout(session.workspaceLayout)
  const detailCollapsed =
    typeof session.detailCollapsed === 'boolean' ? session.detailCollapsed : DEFAULT_SESSION_DETAIL_COLLAPSED
  const detailFocusMode = workspaceLayout === 'top-bottom' && session.detailFocusMode === true
  await setSession({
    openRepos,
    activeRepo: activeRepo && openRepos.includes(activeRepo) ? activeRepo : null,
    detailCollapsed: effectiveDetailCollapsed(workspaceLayout, detailCollapsed),
    detailFocusMode,
    workspaceLayout,
    detailPaneSizes: normalizeDetailPaneSizes(session.detailPaneSizes),
  })
  // Persist first so a crash still leaves the next boot with the correct
  // layout; the live native menu snapshot is only an optimization for
  // immediate radio/check enabled state.
  setMenuWorkspaceLayout(workspaceLayout)
}

function toSafeSessionPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0') || !path.isAbsolute(p)) return null
  return path.normalize(p)
}

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}
