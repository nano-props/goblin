import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import { promises as fs } from 'node:fs'
import { TRPCError } from '@trpc/server'
import {
  createAppRouter,
  type AppRpcHandlers,
  type ExternalAppsSnapshot,
  type GitHubCliState,
  type NetworkOpKind,
  type RpcRequest,
  type RpcResponse,
  type SessionState,
  type EditorPref,
  type TerminalPref,
} from '#/shared/rpc.ts'
import { isHomeRelativeRemotePath, isRemoteRepoId, isResolvableRemotePathInput, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  checkoutBranch,
  deleteBranch,
  deleteUpstreamBranch,
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
import {
  fetchAll,
  getBrowserRemoteUrl,
  getNewPullRequestUrl,
  getRemoteInfo,
  getUpstreamParts,
  pullBranch,
  pushBranch,
} from '#/main/git/remote.ts'
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
import {
  isValidAbsolutePath,
  isValidBranch,
  isValidCwd,
  isValidOptionalBranch,
  isValidRepoLocator,
  toSafeRepoLocator,
  toSafeSessionRepoEntry,
} from '#/main/ipc/validation.ts'
import { applyMainWindowChromeTheme, getMainWindow } from '#/main/window.ts'
import { allRegisteredSurfacesWithCapability, focusedRegisteredSurface } from '#/main/window-registry.ts'
import { getTheme, setColorTheme, setThemePref, subscribeTheme } from '#/main/theme.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  DEFAULT_SESSION_DETAIL_COLLAPSED,
  loadSettings,
  onSettingsWriteError,
  setFetchInterval,
  setGlobalShortcut,
  setGlobalShortcutDisabled,
  setSwapCloseShortcuts,
  setToggleDetailOnActionBarBlankClick,
  setSession,
  setShortcutsDisabled,
  setTerminalApp,
  setTerminalNotificationsEnabled,
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
import { openInPreferredTerminal } from '#/main/system/terminals.ts'
import { openInPreferredEditor } from '#/main/system/editors.ts'
import { probeEditorApps, probeExternalApps, probeTerminalApps } from '#/main/system/external-apps.ts'
import { probeGitHubCli } from '#/main/system/github-cli.ts'
import { broadcastRpcEvent } from '#/main/events.ts'
import { closeWorktreeSession } from '#/main/terminal.ts'
import { openHttpExternal, openHttpsExternal } from '#/main/external-url.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import { consumeExternalOpenPaths } from '#/main/external-open.ts'
import { applySettingsWindowChromeTheme, openSettingsWindow } from '#/main/settings-window.ts'
import {
  normalizeRemoteTarget,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import {
  listSshConfigHosts,
  resolveRemoteTarget as resolveSshRemoteTarget,
  resolveTrackedRemoteTarget,
} from '#/main/ssh/config.ts'
import { testRemoteRepository } from '#/main/ssh/diagnostics.ts'
import {
  checkoutRemoteBranch,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepository,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemotePatch,
  getRemoteSnapshot,
  getRemoteStatus,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/main/ssh/git.ts'
import { runRemoteCommand } from '#/main/ssh/commands.ts'

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
const rpcWindowStorage = new AsyncLocalStorage<BrowserWindow | null>()

let wired = false

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
      const runInRpcContext = <T>(fn: () => Promise<T>): Promise<T> => {
        const rpcWindow = BrowserWindow.fromWebContents(event.sender) ?? null
        // Keep the originating BrowserWindow alongside the AbortSignal for the
        // lifetime of the RPC. Main-side helpers such as native dialogs can
        // then parent themselves to the real caller instead of guessing from
        // current focus, which is brittle once multiple renderer windows exist.
        return rpcWindowStorage.run(rpcWindow, fn)
      }
      const requestId = request.requestId
      if (!isValidRpcRequestId(requestId)) return { ok: true, data: await runInRpcContext(() => procedure(request.input)) }
      const ctrl = new AbortController()
      activeRpcControllers.set(requestId, ctrl)
      try {
        const data = await runInRpcContext(() => rpcSignalStorage.run(ctrl.signal, () => procedure(request.input)))
        return { ok: true, data }
      } finally {
        if (activeRpcControllers.get(requestId) === ctrl) activeRpcControllers.delete(requestId)
      }
    } catch (err) {
      return { ok: false, error: toRpcError(err) }
    }
  })

  subscribeTheme((state) => {
    for (const { window: win } of allRegisteredSurfacesWithCapability('themeSync')) {
      if (!win.isDestroyed()) win.setBackgroundColor(WINDOW_BACKGROUND_BY_COLOR_THEME[state.colorTheme][state.resolved])
    }
    applyMainWindowChromeTheme(state.resolved)
    applySettingsWindowChromeTheme(state.resolved)
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

function currentRpcWindow(): BrowserWindow | null {
  return rpcWindowStorage.getStore() ?? null
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

async function resolveRemoteRepoTarget(repoId: string): Promise<RemoteRepoTarget> {
  const parsed = parseRemoteRepoId(repoId)
  if (!parsed) throw new Error('error.ssh-config-changed')
  return (await resolveRemoteTargetInput(parsed)).target
}

async function resolveRemoteHomeDirectory(target: RemoteRepoTarget): Promise<string> {
  const homeResult = await runRemoteCommand(target, { type: 'printHome' }, { signal: currentRpcSignal() })
  const homePath = homeResult.ok ? homeResult.stdout.trim().split(/\r?\n/, 1)[0]?.trim() ?? '' : ''
  if (!homePath.startsWith('/')) throw new Error('repo-tabs.open-remote-home-unavailable')
  return homePath
}

async function expandRemotePathInput(target: RemoteRepoTarget, remotePath: string): Promise<string> {
  if (!isHomeRelativeRemotePath(remotePath)) return remotePath.trim()
  const homePath = await resolveRemoteHomeDirectory(target)
  return `${homePath}/${remotePath.trim().slice(2)}`.replace(/\/+/g, '/')
}

async function resolveRemoteTargetInput(input: { alias: string; remotePath: string }) {
  const needsHomeExpansion = input.remotePath.startsWith('~/')
  const resolved = await resolveSshRemoteTarget(
    needsHomeExpansion ? { ...input, remotePath: '/' } : input,
    currentRpcSignal(),
  )
  if (!needsHomeExpansion) return resolved
  const normalized = normalizeRemoteTarget({
    ...resolved.target,
    remotePath: await expandRemotePathInput(resolved.target, input.remotePath),
  })
  if (!normalized) throw new Error('repo-tabs.open-remote-home-unavailable')
  return { target: normalized }
}

async function listRemotePathSuggestions(input: { alias: string; remotePath: string; prefix: string }): Promise<string[]> {
  const prefix = input.prefix.trim()
  if (!isResolvableRemotePathInput(prefix)) return []
  let target: RemoteRepoTarget
  try {
    target = (await resolveSshRemoteTarget({ alias: input.alias, remotePath: '/' }, currentRpcSignal())).target
  } catch {
    return []
  }
  let expandedPrefix: string
  try {
    expandedPrefix = await expandRemotePathInput(target, prefix)
  } catch {
    return []
  }
  const normalizedPrefix = expandedPrefix.replace(/\/+/g, '/')
  const endsWithSlash = normalizedPrefix.endsWith('/')
  const searchRoot = endsWithSlash
    ? normalizedPrefix.replace(/\/+$/, '') || '/'
    : normalizedPrefix.slice(0, Math.max(0, normalizedPrefix.lastIndexOf('/'))) || '/'
  const typedLeaf = endsWithSlash ? '' : normalizedPrefix.slice(normalizedPrefix.lastIndexOf('/') + 1)
  const result = await runRemoteCommand(target, { type: 'listDirectories', path: searchRoot, limit: 20 }, { signal: currentRpcSignal() })
  if (!result.ok) return []
  const suggestions = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/') && (typedLeaf.length === 0 || line.slice(line.lastIndexOf('/') + 1).startsWith(typedLeaf)))
  let output = suggestions
  if (prefix.startsWith('~/')) {
    try {
      const homePath = await resolveRemoteHomeDirectory(target)
      output = suggestions.map((path) => (path === homePath ? '~/' : path.startsWith(`${homePath}/`) ? `~/${path.slice(homePath.length + 1)}` : path))
    } catch {
      output = suggestions
    }
  }
  return Array.from(new Set(output)).slice(0, 20)
}

async function externalAppsState(terminalPref: TerminalPref, editorPref: EditorPref): Promise<ExternalAppsSnapshot> {
  const state = await probeExternalApps(terminalPref, editorPref, currentRpcSignal())
  return { terminal: state.terminals, editor: state.editors }
}

function broadcastExternalAppsState(state: ExternalAppsSnapshot): void {
  broadcastRpcEvent({ type: 'terminal-app-changed', ...state.terminal })
  broadcastRpcEvent({ type: 'editor-app-changed', ...state.editor })
}

async function githubCliState(hosts?: string[]): Promise<GitHubCliState> {
  return probeGitHubCli(currentRpcSignal(), hosts)
}

function broadcastGitHubCliState(state: GitHubCliState): void {
  broadcastRpcEvent({ type: 'github-cli-changed', state })
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
      openSettingsWindow: async (input) => {
        await openSettingsWindow(input?.page ?? 'general')
      },
    },
    repo: {
      openDialog: openRepoDialog,
      consumeExternalOpenPaths: async () => consumeExternalOpenPaths(),
      cloneParentDialog: () => openDirectoryDialog('Choose Clone Destination'),
      probe: async ({ cwd }) => {
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          const result = await testRemoteRepository(target)
          if (!result.ok) return { ok: false, message: result.message || 'error.failed-read-repo' }
          return { ok: true, root: target.id, name: target.displayName }
        }
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
        if (isRemoteRepoId(cwd)) {
          const target = await resolveRemoteRepoTarget(cwd)
          const signal = currentRpcSignal()
          const snapshot = await getRemoteSnapshot(target, { signal })
          if (signal?.aborted) return null
          if (!snapshot) return null
          return { branches: snapshot.branches, current: snapshot.current, remote: snapshot.remote }
        }
        if (!isValidCwd(cwd)) return null
        const signal = currentRpcSignal()
        try {
          const available = await probeGitRepository(cwd)
          if (!available.ok) throw new Error(available.message)
          const worktrees = await getWorktrees(cwd, { signal })
          if (signal?.aborted) return null
          const branches = await getBranches(cwd, worktrees, { signal })
          if (signal?.aborted) return null
          const current = await getCurrentBranch(cwd, { signal })
          if (signal?.aborted) return null
          const remote = await getRemoteInfo(cwd, signal)
          if (signal?.aborted) return null
          return { branches, current, remote }
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
        if (!isValidBranch(branch)) return []
        const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 100
        const safeCount = Math.max(1, Math.min(1000, n))
        const offset = typeof skip === 'number' && Number.isFinite(skip) ? Math.floor(skip) : 0
        const safeSkip = Math.max(0, offset)
        const signal = currentRpcSignal()
        if (isRemoteRepoId(cwd)) {
          const target = await resolveRemoteRepoTarget(cwd)
          const log = await getRemoteLog(target, branch, safeCount, safeSkip, { signal })
          return signal?.aborted ? [] : log
        }
        if (!isValidCwd(cwd)) return []
        const log = await getLog(cwd, branch, safeCount, safeSkip, { signal })
        return signal?.aborted ? [] : log
      },
      status: async ({ cwd }) => {
        if (isRemoteRepoId(cwd)) {
          const target = await resolveRemoteRepoTarget(cwd)
          const signal = currentRpcSignal()
          const status = await getRemoteStatus(target, { signal })
          return signal?.aborted ? [] : status
        }
        if (!isValidCwd(cwd)) return []
        const available = await probeGitRepository(cwd)
        if (!available.ok) throw new Error(available.message)
        const signal = currentRpcSignal()
        const status = await getWorkingStatus(cwd, { signal })
        return signal?.aborted ? [] : status
      },
      patch: async ({ cwd, worktreePath }) => {
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-worktree-path' }
          const signal = currentRpcSignal()
          return getRemotePatch(target, worktreePath, { signal })
        }
        return createPatch({ cwd, worktreePath })
      },
      commit: async ({ cwd, hash }) => {
        if (!isValidCwd(cwd) || typeof hash !== 'string' || !hash) return null
        if (!GIT_HASH_RE.test(hash)) return null
        const [meta, files] = await Promise.all([getCommitMeta(cwd, hash), getCommitFileStats(cwd, hash)])
        if (!meta) return null
        return { meta, files }
      },
      checkout: async ({ cwd, branch }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(cwd, 'user', (signal) => checkoutRemoteBranch(target, branch, undefined, { signal }))
        }
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, 'user', (signal) => checkoutBranch(cwd, branch, signal))
      },
      deleteBranch: async (input) => {
        if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
        if (isRemoteRepoId(input.cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(input.cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(input.cwd, 'user', (signal) => deleteRemoteBranch(target, { branch: input.branch, force: input.force, signal }))
        }
        if (!isValidCwd(input.cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(input.cwd, 'user', (signal) => deleteRepoBranch(input, signal))
      },
      removeWorktree: async (input) => {
        if (
          !isValidBranch(input.branch) ||
          !isValidAbsolutePath(input.worktreePath) ||
          typeof input.alsoDeleteBranch !== 'boolean' ||
          (input.forceDeleteBranch !== undefined && typeof input.forceDeleteBranch !== 'boolean')
        ) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        if (isRemoteRepoId(input.cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(input.cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(input.cwd, 'user', (signal) =>
            removeRemoteWorktree(target, { ...input, signal }),
          )
        }
        if (!isValidCwd(input.cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(input.cwd, 'user', (signal) => removeRepoWorktree(input, signal))
      },
      createWorktree: async ({ cwd, worktreePath, newBranch, baseBranch }) => {
        if (!isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        if (isRemoteRepoId(cwd)) {
          if (!isResolvableRemotePathInput(worktreePath)) return { ok: false, message: 'error.invalid-path' }
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          let expandedPath: string
          try {
            expandedPath = await expandRemotePathInput(target, worktreePath)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'repo-tabs.open-remote-home-unavailable' }
          }
          if (!isValidAbsolutePath(expandedPath)) return { ok: false, message: 'error.invalid-path' }
          return runCancellable(cwd, 'user', (signal) =>
            createRemoteWorktree(target, { worktreePath: expandedPath, newBranch, baseBranch, signal }),
          )
        }
        if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, 'user', (signal) => createWorktree(cwd, worktreePath, newBranch, baseBranch, signal))
      },
      pull: async ({ cwd, branch, worktreePath }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        if (worktreePath !== undefined && !isValidAbsolutePath(worktreePath)) {
          return { ok: false, message: 'error.invalid-worktree-path' }
        }
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(cwd, 'user', (signal) => pullRemoteBranch(target, branch, worktreePath, { signal }))
        }
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
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
            if (signal.aborted) return { ok: false, message: 'cancelled' }
            const target = resolveKnownWorktree(worktrees, worktreePath, branch)
            if (!target.ok) return target
            if (signal.aborted) return { ok: false, message: 'cancelled' }
            targetPath = target.path
          }
          return pullBranch(cwd, branch, targetPath, signal)
        })
      },
      push: async ({ cwd, branch }) => {
        if (!isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(cwd, 'user', (signal) => pushRemoteBranch(target, branch, { signal }))
        }
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
        return runCancellable(cwd, 'user', (signal) => pushBranch(cwd, branch, signal))
      },
      fetch: async ({ cwd, kind }) => {
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          return runCancellable(cwd, kind === 'background' ? 'background' : 'user', (signal) =>
            fetchRemoteRepository(target, { signal }),
          )
        }
        if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
        const available = await probeGitRepository(cwd)
        if (!available.ok) return available
        return runCancellable(cwd, kind === 'background' ? 'background' : 'user', (signal) => fetchAll(cwd, signal))
      },
      abort: async ({ cwd }) => {
        if (!isValidRepoLocator(cwd)) return false
        const ctrl = activeOpControllers.get(cwd)
        if (!ctrl) return false
        ctrl.ctrl.abort()
        return true
      },
      openRemote: async ({ cwd, branch }) => {
        if (isRemoteRepoId(cwd)) {
          let target: RemoteRepoTarget
          try {
            target = await resolveRemoteRepoTarget(cwd)
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
          }
          const url = await getRemoteBrowserUrl(target, branch, { signal: currentRpcSignal() })
          if (!url) return { ok: false, message: 'error.open-remote-unavailable' }
          if (!(await openHttpsExternal(url))) return { ok: false, message: 'error.invalid-url' }
          return { ok: true, message: url }
        }
        return openRepoRemote({ cwd, branch })
      },
      openInFinder: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        shell.showItemInFolder(p)
        return { ok: true, message: p }
      },
      openTerminal: async ({ path: p }) => {
        if (isRemoteRepoId(p)) {
          return { ok: false, message: 'Remote terminal via external app not yet supported. Use the built-in terminal.' }
        }
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInPreferredTerminal(p, getTerminalApp())
      },
      openEditor: async ({ path: p }) => {
        if (isRemoteRepoId(p)) {
          return { ok: false, message: 'Remote editor not yet supported' }
        }
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInPreferredEditor(p, getEditorApp())
      },
    },
    remote: {
      listSshHosts: async () => listSshConfigHosts(),
      resolveTarget: async (input) => resolveRemoteTargetInput(input),
      listPathSuggestions: async (input) => listRemotePathSuggestions(input),
      testRepository: async ({ target }) => {
        const normalized = normalizeRemoteTarget(target)
        if (!normalized || normalized.id !== target.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid remote repository target' })
        }
        try {
          const resolved = await resolveTrackedRemoteTarget(normalized, currentRpcSignal())
          return testRemoteRepository(resolved.target, { signal: currentRpcSignal() })
        } catch {
          return {
            target: normalized,
            ok: false,
            category: 'config-changed',
            message: 'config-changed',
            stages: [
              { name: 'ssh', label: 'ssh', status: 'failed', category: 'config-changed', message: 'config-changed' },
              { name: 'shell', label: 'shell', status: 'skipped' },
              { name: 'git', label: 'git', status: 'skipped' },
              { name: 'path', label: 'path', status: 'skipped' },
              { name: 'repo', label: 'repo', status: 'skipped' },
            ],
          }
        }
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
          terminalNotificationsEnabled: s.terminalNotificationsEnabled,
          shortcutsDisabled: s.shortcutsDisabled,
          globalShortcutDisabled: s.globalShortcutDisabled,
          swapCloseShortcuts: s.swapCloseShortcuts,
          toggleDetailOnActionBarBlankClick: s.toggleDetailOnActionBarBlankClick,
          globalShortcut: s.globalShortcut,
          globalShortcutRegistered: isGlobalShortcutRegistered(),
          terminalApp: s.terminalApp,
          editorApp: s.editorApp,
          session: s.session,
          recentRepos: s.recentRepos,
        }
      },
      setFetchInterval: async ({ sec }) => {
        if (!Number.isFinite(sec)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid fetch interval' })
        const clamped = await setFetchInterval(sec)
        broadcastRpcEvent({ type: 'fetch-interval-changed', sec: clamped })
      },
      setTerminalNotificationsEnabled: async ({ enabled }) => {
        if (typeof enabled !== 'boolean') return
        const saved = await setTerminalNotificationsEnabled(enabled)
        broadcastRpcEvent({ type: 'terminal-notifications-changed', enabled: saved })
      },
      setShortcutsDisabled: async ({ disabled }) => {
        if (typeof disabled !== 'boolean') return
        const saved = await setShortcutsDisabled(disabled)
        buildAppMenu()
        broadcastRpcEvent({ type: 'shortcuts-disabled-changed', disabled: saved })
      },
      setGlobalShortcutDisabled: async ({ disabled }) => {
        if (typeof disabled !== 'boolean') return
        const saved = await setGlobalShortcutDisabled(disabled)
        const s = await loadSettings()
        syncGlobalShortcuts(saved, s.globalShortcut)
        broadcastRpcEvent({ type: 'global-shortcut-disabled-changed', disabled: saved })
        broadcastRpcEvent({ type: 'global-shortcut-changed', state: globalShortcutPayload(s.globalShortcut) })
      },
      setSwapCloseShortcuts: async ({ swapped }) => {
        if (typeof swapped !== 'boolean') return
        const saved = await setSwapCloseShortcuts(swapped)
        buildAppMenu()
        broadcastRpcEvent({ type: 'swap-close-shortcuts-changed', swapped: saved })
      },
      setToggleDetailOnActionBarBlankClick: async ({ enabled }) => {
        if (typeof enabled !== 'boolean') return
        const saved = await setToggleDetailOnActionBarBlankClick(enabled)
        broadcastRpcEvent({ type: 'toggle-detail-on-action-bar-blank-click-changed', enabled: saved })
      },
      setGlobalShortcut: async ({ accelerator }) => {
        const parsed = parseGlobalShortcut(accelerator)
        const s = await loadSettings()
        if (!parsed) return globalShortcutPayload(s.globalShortcut)
        if (isReservedGlobalShortcut(parsed)) return globalShortcutPayload(s.globalShortcut)
        const registered = s.globalShortcutDisabled || replaceGlobalShortcut(false, s.globalShortcut, parsed)
        if (!registered && !s.globalShortcutDisabled) return globalShortcutPayload(s.globalShortcut)
        const saved = await setGlobalShortcut(parsed)
        const payload = globalShortcutPayload(saved)
        broadcastRpcEvent({ type: 'global-shortcut-changed', state: payload })
        return payload
      },
      setTerminalApp: async ({ pref }) => {
        const saved = await setTerminalApp(pref)
        const payload = await probeTerminalApps(saved, currentRpcSignal())
        broadcastRpcEvent({ type: 'terminal-app-changed', ...payload })
        return payload
      },
      setEditorApp: async ({ pref }) => {
        const saved = await setEditorApp(pref)
        const payload = probeEditorApps(saved)
        broadcastRpcEvent({ type: 'editor-app-changed', ...payload })
        return payload
      },
      saveSession: async ({ session }) => saveSession(session),
      addRecentRepo: async ({ repo }) => {
        const safeRepo = toSafeSessionRepoEntry(repo)
        if (!safeRepo) return []
        const recentRepos = await addRecentRepo(safeRepo)
        buildAppMenu()
        return recentRepos
      },
      clearRecentRepos: async () => {
        await clearRecentRepos()
        buildAppMenu()
        return
      },
    },
    externalApps: {
      get: async () => {
        const s = await loadSettings()
        return externalAppsState(s.terminalApp, s.editorApp)
      },
      refresh: async () => {
        const s = await loadSettings()
        const state = await externalAppsState(s.terminalApp, s.editorApp)
        broadcastExternalAppsState(state)
        return state
      },
    },
    githubCli: {
      get: async (input) => githubCliState(input?.hosts),
      refresh: async (input) => {
        const state = await probeGitHubCli(currentRpcSignal(), input?.hosts, { force: true })
        broadcastGitHubCliState(state)
        return state
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
  // Prefer the actual RPC caller, then fall back to focus, then the main
  // window. This keeps dialogs attached to the window that initiated the
  // action without breaking older call sites that predate multi-window RPC.
  const win = currentRpcWindow() ?? focusedRegisteredSurface()?.window ?? getMainWindow() ?? null
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
    alsoDeleteUpstream,
  }: {
    cwd: string
    branch: string
    force?: boolean
    alsoDeleteUpstream?: boolean
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
  // Read upstream config BEFORE deleting the local branch — git branch -d
  // removes the [branch "…"] section from .git/config, so the info would
  // be gone after deletion.
  const upstream = alsoDeleteUpstream ? await getUpstreamParts(cwd, branch, signal) : null
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const delResult = await deleteBranch(cwd, branch, { force: shouldForce, signal })
  if (!delResult.ok) return delResult
  if (upstream && upstream.remote !== '.') {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    const upstreamResult = await deleteUpstreamBranch(cwd, upstream.remote, upstream.branch, signal)
    if (!upstreamResult.ok) {
      return { ok: false, message: 'error.upstream-delete-failed' }
    }
  }
  return delResult
}

async function removeRepoWorktree(
  {
    cwd,
    branch,
    worktreePath,
    alsoDeleteBranch,
    forceDeleteBranch,
    alsoDeleteUpstream,
  }: {
    cwd: string
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
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

  // Read upstream config BEFORE deleting the local branch — git branch -d
  // removes the [branch "…"] section from .git/config.
  const upstream = alsoDeleteBranch && alsoDeleteUpstream ? await getUpstreamParts(cwd, branch, signal) : null
  if (signal?.aborted) return { ok: false, message: 'cancelled' }

  const removeResult = await removeWorktree(cwd, target.path, signal)
  if (!removeResult.ok) return removeResult
  closeWorktreeSession(root, target.path)
  if (alsoDeleteBranch) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    const delResult = await deleteBranch(cwd, branch, { force: shouldForceDeleteBranch, signal })
    if (!delResult.ok) return delResult
    if (upstream && upstream.remote !== '.') {
      if (signal?.aborted) return { ok: false, message: 'cancelled' }
      const upstreamResult = await deleteUpstreamBranch(cwd, upstream.remote, upstream.branch, signal)
      if (!upstreamResult.ok) {
        return { ok: false, message: 'error.upstream-delete-failed' }
      }
    }
  }
  return removeResult
}

async function createPatch({ cwd, worktreePath }: { cwd: string; worktreePath: string }): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidAbsolutePath(worktreePath))
    return { ok: false, message: 'error.invalid-worktree-path' }
  const rpcSignal = currentRpcSignal()
  if (rpcSignal?.aborted) return { ok: false, message: 'cancelled' }
  const ctrl = new AbortController()
  let timedOut = false
  const abortPatch = () => ctrl.abort()
  rpcSignal?.addEventListener('abort', abortPatch, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, PATCH_TIMEOUT_MS)
  if ('unref' in timeout && typeof timeout.unref === 'function') timeout.unref()
  try {
    const worktrees = await getWorktrees(cwd, { includeStatus: false, signal: ctrl.signal })
    if (timedOut) return { ok: false, message: `git timed out after ${PATCH_TIMEOUT_MS / 1000}s` }
    if (ctrl.signal.aborted) return { ok: false, message: 'cancelled' }
    const target = resolveKnownWorktree(worktrees, worktreePath)
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
    rpcSignal?.removeEventListener('abort', abortPatch)
    clearTimeout(timeout)
  }
}

async function openRepoRemote({ cwd, branch }: { cwd: string; branch?: string }): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidOptionalBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
  const signal = currentRpcSignal()
  const signalOptions = signal ? { signal } : undefined
  // Only branch opens need the default branch: it tells us whether a PR is a
  // reverse/default-branch PR that should not be opened from the default row.
  const defaultBranch = branch ? await getDefaultBranch(cwd, signalOptions) : ''
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const isDefaultBranch = !!defaultBranch && branch === defaultBranch
  if (branch) {
    const detectedPr = await getBranchPullRequest(cwd, branch, signalOptions)
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    if (
      detectedPr?.url &&
      branchPullRequestBelongsToBranch({ name: branch, isDefault: isDefaultBranch }, detectedPr) &&
      (await openHttpsExternal(detectedPr.url))
    ) {
      return { ok: true, message: detectedPr.url }
    }
  }
  if (typeof branch === 'string' && branch && !isDefaultBranch) {
    const prUrl = await getNewPullRequestUrl(cwd, branch, signalOptions)
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    if (prUrl && (await openHttpsExternal(prUrl))) return { ok: true, message: prUrl }
  }
  const url = await getBrowserRemoteUrl(cwd, signal ? { branch, signal } : { branch })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!url) return { ok: false, message: 'error.open-remote-unavailable' }
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

async function probeGitRepository(cwd: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const ok = await isGitRepo(cwd)
  if (ok) return { ok: true }
  const readable = await probeReadableDirectory(cwd)
  if (!readable.ok) return readable
  return { ok: false, message: 'error.not-git-repo' }
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
  const openRepos = session.openRepos.map(toSafeSessionRepoEntry).filter((p): p is NonNullable<typeof p> => p !== null)
  const activeRepo = toSafeRepoLocator(session.activeRepo)
  const workspaceLayout = normalizeWorkspaceLayout(session.workspaceLayout)
  const detailCollapsed =
    typeof session.detailCollapsed === 'boolean' ? session.detailCollapsed : DEFAULT_SESSION_DETAIL_COLLAPSED
  const detailFocusMode = workspaceLayout === 'top-bottom' && session.detailFocusMode === true
  await setSession({
    openRepos,
    activeRepo: activeRepo && openRepos.some((repo) => repo.id === activeRepo) ? activeRepo : null,
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

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}
