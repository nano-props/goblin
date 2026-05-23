import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
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
} from '#/shared/rpc.ts'
import {
  checkoutBranch,
  deleteBranch,
  getBranches,
  getCurrentBranch,
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
import { getBranchPullRequest, getBranchPullRequests } from '#/main/git/pull-requests.ts'
import { getCommitFileStats, getCommitMeta } from '#/main/git/log.ts'
import { PROTECTED_BRANCHES, type ExecResult, type PullRequestFetchMode } from '#/shared/git-types.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { checkGitAvailable } from '#/main/git/helper.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd, isValidOptionalBranch } from '#/main/ipc/validation.ts'
import { getMainWindow } from '#/main/window.ts'
import { getTheme, setThemePref, subscribeTheme } from '#/main/theme.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  DEFAULT_SESSION_DETAIL_COLLAPSED,
  loadSettings,
  onSettingsWriteError,
  setFetchInterval,
  setGlobalShortcut,
  setLangPref,
  setSession,
  setShortcutsDisabled,
} from '#/main/settings.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut, syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { getCurrentLang, getDictionary, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { isGhosttyInstalled, openInGhostty } from '#/main/system/ghostty.ts'
import { isVSCodeInstalled, openInVSCode } from '#/main/system/vscode.ts'
import { broadcastRpcEvent } from '#/main/events.ts'

const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'
const GIT_HASH_RE = /^[0-9a-fA-F]{7,64}$/
const PATCH_TIMEOUT_MS = 90_000
const MAX_RPC_PROCEDURE_PATH_LENGTH = 128
const RPC_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const FORBIDDEN_RPC_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  done: Promise<void>
}

const activeOpControllers = new Map<string, ActiveNetworkOp>()

let wired = false

export function wireRpcIpc(): void {
  if (wired) return
  wired = true

  const router = createAppRouter(createRpcHandlers())

  ipcMain.handle('goblin:rpc', async (_event, request: RpcRequest): Promise<RpcResponse> => {
    try {
      if (!isValidRpcRequest(request)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid RPC request' })
      }
      const caller = router.createCaller({})
      const procedure = request.path.split('.').reduce<unknown>(resolveRpcPathSegment, caller)
      if (typeof procedure !== 'function') {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown RPC procedure: ${request.path}` })
      }
      return { ok: true, data: await procedure(request.input) }
    } catch (err) {
      return { ok: false, error: toRpcError(err) }
    }
  })

  subscribeTheme((state) => {
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
  if (!segments.every((segment) => RPC_PATH_SEGMENT_RE.test(segment) && !FORBIDDEN_RPC_PATH_SEGMENTS.has(segment))) {
    return false
  }
  return true
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

function createRpcHandlers(): AppRpcHandlers {
  return {
    app: {
      openProjectGitHub: async () => {
        if (!(await openHttpsExternal(PROJECT_GITHUB_URL))) return { ok: false, message: 'error.invalid-url' }
        return { ok: true, message: PROJECT_GITHUB_URL }
      },
    },
    repo: {
      openDialog: openRepoDialog,
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
      snapshot: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return null
        const worktrees = await getWorktrees(cwd)
        const branches = await getBranches(cwd, worktrees)
        const current = await getCurrentBranch(cwd)
        return { branches, current }
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
        const prs = await getBranchPullRequests(cwd, branchSet, { mode })
        if (!prs) return null
        return Array.from(prs, ([branch, pullRequest]) => ({ branch, pullRequest }))
      },
      log: async ({ cwd, branch, count }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return []
        const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 100
        const safeCount = Math.max(1, Math.min(1000, n))
        return getLog(cwd, branch, safeCount)
      },
      status: async ({ cwd }) => {
        if (!isValidCwd(cwd)) return []
        return getWorkingStatus(cwd)
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
        return checkoutBranch(cwd, branch)
      },
      deleteBranch: deleteRepoBranch,
      removeWorktree: removeRepoWorktree,
      createWorktree: async ({ cwd, worktreePath, newBranch, baseBranch }) => {
        if (!isValidCwd(cwd) || !isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
        if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
        return createWorktree(cwd, worktreePath, newBranch, baseBranch)
      },
      pull: async ({ cwd, branch, worktreePath }) => {
        if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
        let targetPath: string | undefined
        if (worktreePath !== undefined) {
          if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-worktree-path' }
          const target = resolveKnownWorktree(await getWorktrees(cwd), worktreePath, branch)
          if (!target.ok) return target
          targetPath = target.path
        }
        return runCancellable(cwd, 'user', (signal) => pullBranch(cwd, branch, targetPath, signal))
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
      openInGhostty: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInGhostty(p)
      },
      openInVSCode: async ({ path: p }) => {
        if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
        return openInVSCode(p)
      },
      ghosttyInstalled: async () => isGhosttyInstalled(),
      vscodeInstalled: () => isVSCodeInstalled(),
    },
    theme: {
      get: () => getTheme(),
      setPref: async ({ pref }) => {
        if (pref !== 'auto' && pref !== 'light' && pref !== 'dark') return getTheme()
        return setThemePref(pref)
      },
    },
    settings: {
      get: async () => {
        const s = await loadSettings()
        return {
          theme: s.theme,
          fetchIntervalSec: s.fetchIntervalSec,
          shortcutsDisabled: s.shortcutsDisabled,
          globalShortcut: s.globalShortcut,
          globalShortcutRegistered: isGlobalShortcutRegistered(),
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
        await setLangPref(pref)
        const lang = resolveLang(pref)
        setCurrentLang(lang)
        buildAppMenu()
        const payload = { lang, pref, dict: getDictionary() }
        broadcastRpcEvent({ type: 'i18n-changed', payload })
        return payload
      },
    },
  }
}

async function openRepoDialog(): Promise<string | null> {
  const win = getMainWindow() ?? BrowserWindow.getFocusedWindow()
  const opts: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
    title: 'Open Git Repository',
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function deleteRepoBranch({
  cwd,
  branch,
  force,
}: {
  cwd: string
  branch: string
  force?: boolean
}): Promise<ExecResult> {
  if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
  const current = await getCurrentBranch(cwd)
  if (branch === current) return { ok: false, message: 'error.cannot-delete-current-branch' }
  if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
  const worktrees = await getWorktrees(cwd)
  if (worktrees.some((wt) => wt.branch === branch)) {
    return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
  }
  const shouldForce = force === true
  if (!shouldForce && !(await isSafelyDeletableBranch(cwd, branch))) {
    return { ok: false, message: 'error.branch-not-fully-merged' }
  }
  return deleteBranch(cwd, branch, { force: shouldForce })
}

async function removeRepoWorktree({
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
}): Promise<ExecResult> {
  if (
    !isValidCwd(cwd) ||
    !isValidBranch(branch) ||
    !isValidAbsolutePath(worktreePath) ||
    typeof alsoDeleteBranch !== 'boolean' ||
    (forceDeleteBranch !== undefined && typeof forceDeleteBranch !== 'boolean')
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const root = await getRepoRoot(cwd)
  const worktrees = await getWorktrees(cwd)
  const resolved = resolveRemovableWorktree(worktrees, branch, worktreePath, root)
  if (!resolved.ok) return resolved
  const target = resolved.target

  if (target.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  if (target.isDirty !== false) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }

  const shouldForceDeleteBranch = forceDeleteBranch === true
  if (alsoDeleteBranch) {
    if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    if (!shouldForceDeleteBranch && !(await isSafelyDeletableBranch(cwd, branch))) {
      return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
    }
  }

  const removeResult = await removeWorktree(cwd, target.path)
  if (!removeResult.ok) return removeResult
  if (alsoDeleteBranch) {
    const delResult = await deleteBranch(cwd, branch, { force: shouldForceDeleteBranch })
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
  if (branch) {
    const detectedPr = await getBranchPullRequest(cwd, branch)
    if (detectedPr?.url && (await openHttpsExternal(detectedPr.url))) return { ok: true, message: detectedPr.url }
  }
  const isDefaultBranch = branch === 'main' || branch === 'master' || branch === 'trunk'
  if (typeof branch === 'string' && branch && !isDefaultBranch) {
    const prUrl = await getPullRequestUrl(cwd, branch)
    if (prUrl && (await openHttpsExternal(prUrl))) return { ok: true, message: prUrl }
  }
  const url = await getGitHubUrl(cwd)
  if (!url) return { ok: false, message: 'error.open-github-no-origin' }
  if (!(await openHttpsExternal(url))) return { ok: false, message: 'error.invalid-url' }
  return { ok: true, message: url }
}

async function isSafelyDeletableBranch(cwd: string, branch: string): Promise<boolean> {
  const upstream = await getUpstream(cwd, branch)
  return isAncestor(cwd, branch, upstream ?? 'HEAD')
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

async function openHttpsExternal(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}

function saveSession(session: SessionState): Promise<void> {
  if (!session || !Array.isArray(session.openRepos)) return Promise.resolve()
  const openRepos = session.openRepos.map(toSafeSessionPath).filter((p): p is string => p !== null)
  const activeRepo = toSafeSessionPath(session.activeRepo)
  return setSession({
    openRepos,
    activeRepo: activeRepo && openRepos.includes(activeRepo) ? activeRepo : null,
    detailCollapsed:
      typeof session.detailCollapsed === 'boolean' ? session.detailCollapsed : DEFAULT_SESSION_DETAIL_COLLAPSED,
  })
}

function toSafeSessionPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0') || !path.isAbsolute(p)) return null
  return path.normalize(p)
}

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}
