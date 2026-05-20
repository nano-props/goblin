// IPC handlers for git repo operations. Each handler validates incoming
// arguments before passing to the git layer — the renderer is trusted
// (single preload bridge) but a malformed message shouldn't crash main.

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getMainWindow } from '#/main/window.ts'
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
import { fetchAll, pullBranch, pushBranch } from '#/main/git/remote.ts'
import { getWorkingStatus } from '#/main/git/status.ts'
import { getWorktreePatch } from '#/main/git/patch.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/main/git/guards.ts'
import { createWorktree, getWorktrees, removeWorktree } from '#/main/git/worktrees.ts'
import { getBranchPullRequests } from '#/main/git/pull-requests.ts'
import { getCommitFileStats, getCommitMeta } from '#/main/git/log.ts'
import { PROTECTED_BRANCHES, type ExecResult } from '#/shared/git-types.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd } from '#/main/ipc/validation.ts'

const GIT_HASH_RE = /^[0-9a-fA-F]{7,64}$/

type NetworkOpKind = 'user' | 'background'

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  done: Promise<void>
}

/** Active AbortControllers keyed by repo id. Network ops (push/pull/fetch)
 *  register here so the renderer can cancel them. Only one network op per
 *  repo is allowed at a time; callers get a busy result instead of
 *  accidentally cancelling an in-flight operation from another UI path. */
const activeOpControllers = new Map<string, ActiveNetworkOp>()

async function isSafelyDeletableBranch(cwd: string, branch: string): Promise<boolean> {
  const upstream = await getUpstream(cwd, branch)
  return isAncestor(cwd, branch, upstream ?? 'HEAD')
}

/** Wrap a network op so its AbortController is registered, then cleaned
 *  up regardless of success/failure/abort. Returns the underlying
 *  ExecResult; if another network op is active for this repo, returns
 *  a busy result instead of cancelling that operation. */
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
    if (activeOpControllers.get(repoId) === slot) {
      activeOpControllers.delete(repoId)
    }
    resolveDone()
  }
}

export function wireRepoIpc(): void {
  // ---- Open dialog --------------------------------------------------------
  ipcMain.handle('repo:open-dialog', async () => {
    const win = getMainWindow() ?? BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Open Git Repository',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ---- Repo metadata ------------------------------------------------------
  ipcMain.handle('repo:probe', async (_e, cwd: string) => {
    if (!isValidCwd(cwd)) return { ok: false }
    const ok = await isGitRepo(cwd)
    if (!ok) return { ok: false }
    const root = await getRepoRoot(cwd)
    const name = await getRepoName(cwd)
    return { ok: true, root, name }
  })

  // ---- Snapshot of branches + current branch -----------------------------
  // Worktrees are queried internally so `getBranches` can mark which
  // branches are checked out elsewhere, but we don't return them — the
  // BranchList rows already carry per-branch worktree info, and the
  // dedicated Worktrees tab was retired.
  ipcMain.handle('repo:snapshot', async (_e, cwd: string) => {
    if (!isValidCwd(cwd)) return null
    const worktrees = await getWorktrees(cwd)
    const branches = await getBranches(cwd, worktrees)
    const current = await getCurrentBranch(cwd)
    return { branches, current }
  })

  ipcMain.handle('repo:pull-requests', async (_e, cwd: string, branches?: string[]) => {
    if (!isValidCwd(cwd)) return []
    if (branches !== undefined && !Array.isArray(branches)) return []
    const branchSet =
      branches === undefined
        ? undefined
        : new Set(
            branches.filter((branch): branch is string => {
              return isValidBranch(branch)
            }),
          )
    if (branchSet?.size === 0) return []
    const prs = await getBranchPullRequests(cwd, branchSet)
    if (!prs) return null
    return Array.from(prs, ([branch, pullRequest]) => ({ branch, pullRequest }))
  })

  ipcMain.handle('repo:log', async (_e, cwd: string, branch: string, count?: number) => {
    if (!isValidCwd(cwd) || !isValidBranch(branch)) return []
    // Clamp count: a renderer (or compromised one) shouldn't be able to ask
    // for Number.MAX_SAFE_INTEGER commits and tie up the main process.
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 100
    const safeCount = Math.max(1, Math.min(1000, n))
    return getLog(cwd, branch, safeCount)
  })

  ipcMain.handle('repo:status', async (_e, cwd: string) => {
    if (!isValidCwd(cwd)) return []
    return getWorkingStatus(cwd)
  })

  // ---- Patch (worktree → git apply --binary -friendly text) --------------
  // Caller passes a worktree path (NOT necessarily the repo root) so we
  // generate the patch against that specific worktree's HEAD. Returned
  // shape mirrors ExecResult so the renderer can surface git errors via
  // the existing toast machinery without needing a separate code path.
  ipcMain.handle('repo:patch', async (_e, cwd: string, worktreePath: string) => {
    if (!isValidCwd(cwd) || !isValidAbsolutePath(worktreePath)) {
      return { ok: false, message: 'error.invalid-worktree-path' }
    }
    try {
      const target = resolveKnownWorktree(await getWorktrees(cwd), worktreePath)
      if (!target.ok) return target
      const patch = await getWorktreePatch(target.path)
      return { ok: true, message: patch }
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string }
      const msg = (typeof e.stderr === 'string' && e.stderr.trim()) || e.message || 'error.unknown'
      return { ok: false, message: msg }
    }
  })

  // ---- Commit detail ------------------------------------------------------
  ipcMain.handle('repo:commit', async (_e, cwd: string, hash: string) => {
    if (!isValidCwd(cwd) || typeof hash !== 'string' || !hash) return null
    if (!GIT_HASH_RE.test(hash)) return null
    const [meta, files] = await Promise.all([getCommitMeta(cwd, hash), getCommitFileStats(cwd, hash)])
    if (!meta) return null
    return { meta, files }
  })

  // ---- Mutating operations ------------------------------------------------
  ipcMain.handle('repo:checkout', async (_e, cwd: string, branch: string) => {
    if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
    return checkoutBranch(cwd, branch)
  })

  ipcMain.handle('repo:delete-branch', async (_e, cwd: string, branch: string, force?: boolean) => {
    if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
    const current = await getCurrentBranch(cwd)
    if (branch === current) return { ok: false, message: 'error.cannot-delete-current-branch' }
    if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
    const worktrees = await getWorktrees(cwd)
    if (worktrees.some((wt) => wt.branch === branch)) {
      return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
    }
    const shouldForce = force === true
    if (!shouldForce) {
      if (!(await isSafelyDeletableBranch(cwd, branch))) return { ok: false, message: 'error.branch-not-fully-merged' }
    }
    return deleteBranch(cwd, branch, { force: shouldForce })
  })

  // Remove a linked worktree (and optionally its branch). Refuses when:
  //   - target is the main / repo-root worktree (resolveRemovableWorktree)
  //   - working tree has uncommitted changes (would lose work)
  //   - worktree is locked (`git worktree lock`)
  // Plus, when `alsoDeleteBranch` is set:
  //   - protected branch (main/master/develop/trunk)
  //   - branch is not yet merged into its upstream (when configured) or
  //     HEAD (without upstream) — i.e. would be rejected by `git branch -d`.
  //     We check up front so a
  //     non-deletable branch doesn't leave us with a removed worktree
  //     and a "delete failed" toast (a confusing half-applied state).
  //     `forceDeleteBranch` deliberately bypasses only this mergedness
  //     check after the renderer has shown a stronger confirmation; dirty,
  //     locked, main-worktree, and protected-branch guards still apply.
  //
  // A branch with no upstream is fine on its own — `git worktree add
  // -b new-branch ../foo` is a routine flow and `git worktree remove`
  // doesn't object. Without `alsoDeleteBranch` we don't even look at
  // ahead/behind: removing the worktree leaves the branch ref intact
  // and every commit reachable.
  //
  // Each precondition maps to its own i18n key so the renderer's toast
  // explains *why* removal was refused, instead of git's generic error.
  ipcMain.handle(
    'repo:remove-worktree',
    async (
      _e,
      cwd: string,
      branch: string,
      worktreePath: string,
      alsoDeleteBranch: boolean,
      forceDeleteBranch?: boolean,
    ) => {
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

      // `getWorktrees` (run a few lines up) already filled `isDirty` by
      // running `git status --porcelain -z` in each worktree. Trust it
      // rather than running the same command again. `undefined` means
      // we couldn't read status — refuse rather than blindly deleting.
      if (target.isDirty !== false) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }

      const shouldForceDeleteBranch = forceDeleteBranch === true

      if (alsoDeleteBranch) {
        // Mirror the protected-branch guard from `repo:delete-branch`.
        // Catch up front so we don't remove the worktree first and then
        // refuse the delete (leaves the user in a half-applied state).
        if (PROTECTED_BRANCHES.has(branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }

        // Mirror `git branch -d`: with an upstream, the branch must be an
        // ancestor of that upstream; without one, it must be an ancestor
        // of HEAD. We pre-check here so a non-deletable
        // branch surfaces *before* we delete the worktree.
        // If the renderer passed `forceDeleteBranch`, the user has
        // accepted the stronger warning and we delete with `branch -D`
        // after the worktree is removed.
        if (!shouldForceDeleteBranch && !(await isSafelyDeletableBranch(cwd, branch))) {
          return { ok: false, message: 'error.cannot-remove-unpushed-worktree' }
        }
      }

      const removeResult = await removeWorktree(cwd, target.path)
      if (!removeResult.ok) return removeResult
      if (alsoDeleteBranch) {
        // Safe path uses -d after the predicate above mirrors Git's rule.
        // Forced path uses -D after the renderer's stronger confirmation.
        // If git still refuses (race: branch checked out elsewhere after
        // our check), surface the error — the worktree is gone but that's
        // a clean state the user can recover from (branch still exists).
        const delResult = await deleteBranch(cwd, branch, { force: shouldForceDeleteBranch })
        if (!delResult.ok) return delResult
      }
      return removeResult
    },
  )

  // Create a new linked worktree from a base branch. The renderer's
  // dialog is guided to one mode only — `git worktree add -b
  // <newBranch> <path> <baseBranch>` — so we don't expose detached
  // worktrees or "reuse existing branch" here. Validation is strict on
  // names (so a stray "-foo" can't become a flag) and on the path
  // shape (must be absolute, no NULs); everything else (path already
  // exists, parent dir missing, branch already exists) is delegated
  // to git, which produces a precise error message we surface as-is.
  ipcMain.handle(
    'repo:create-worktree',
    async (_e, cwd: string, worktreePath: string, newBranch: string, baseBranch: string) => {
      if (!isValidCwd(cwd) || !isValidBranch(newBranch) || !isValidBranch(baseBranch)) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      // Reject relative paths and embedded NULs up front: the dialog
      // always supplies an absolute path (derived from the repo's
      // parent dir) so a relative one means a tampered renderer or a
      // bug. Letting git resolve a relative path against `cwd` would
      // be surprising — the user's input was the absolute string in
      // the textbox, not "wherever git happens to think the repo is."
      if (!isValidAbsolutePath(worktreePath)) {
        return { ok: false, message: 'error.invalid-path' }
      }
      return createWorktree(cwd, worktreePath, newBranch, baseBranch)
    },
  )

  ipcMain.handle('repo:pull', async (_e, cwd: string, branch: string, worktreePath?: string) => {
    if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
    let targetPath: string | undefined
    if (worktreePath !== undefined) {
      if (!isValidAbsolutePath(worktreePath)) return { ok: false, message: 'error.invalid-worktree-path' }
      const target = resolveKnownWorktree(await getWorktrees(cwd), worktreePath, branch)
      if (!target.ok) return target
      targetPath = target.path
    }
    return runCancellable(cwd, 'user', (signal) => pullBranch(cwd, branch, targetPath, signal))
  })

  ipcMain.handle('repo:push', async (_e, cwd: string, branch: string) => {
    if (!isValidCwd(cwd) || !isValidBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
    return runCancellable(cwd, 'user', (signal) => pushBranch(cwd, branch, signal))
  })

  ipcMain.handle('repo:fetch', async (_e, cwd: string, kind?: NetworkOpKind) => {
    if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
    return runCancellable(cwd, kind === 'background' ? 'background' : 'user', (signal) => fetchAll(cwd, signal))
  })

  // Cancel the in-flight network op for a repo, if any. No-op when
  // nothing is running. Returns true when an in-flight op was signalled
  // so the renderer can give immediate visual feedback.
  ipcMain.handle('repo:abort', (_e, cwd: string) => {
    if (!isValidCwd(cwd)) return false
    const ctrl = activeOpControllers.get(cwd)
    if (!ctrl) return false
    ctrl.ctrl.abort()
    return true
  })
}
