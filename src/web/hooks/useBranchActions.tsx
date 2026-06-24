import { useReposStore } from '#/web/stores/repos/store.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import {
  getRepositoryPatch,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
} from '#/web/repo-client.ts'
import { openRemoteRepositoryEditor, openRemoteRepositoryTerminal } from '#/web/remote-client.ts'
import { openBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { getBranchWorktreeState } from '#/web/stores/repos/worktree-state.ts'
import { dispatchRepoBranchAction, dispatchRepoUiAction, isPushProtected } from '#/web/stores/repos/branch-action-write-paths.ts'
import { useBranchActionDialogsStore } from '#/web/stores/repos/branch-action-dialogs.ts'
import {
  branchActionBusyItemId,
  type BranchActionRepo,
  isBranchActionBlocked,
  type BranchActionItemId,
} from '#/web/hooks/branch-action-state.ts'

export type { BranchActionItemId } from '#/web/hooks/branch-action-state.ts'

const SILENT_SUCCESS_OPS = new Set<BranchActionItemId>(['remote', 'terminal', 'editor'])
type LocalBranchActionItemId = 'copyPatch' | 'remote' | 'terminal' | 'editor'

export interface BranchActionCapabilities {
  canRemoveWorktree: boolean
  isRegularBranch: boolean
  canCopyPatch: boolean
  canPull: boolean
  canPush: boolean
  canOpenRemote: boolean
  canOpenTerminal: boolean
  canOpenEditor: boolean
}

export function getBranchActionCapabilities(repo: BranchActionRepo, branch: RepoBranchState): BranchActionCapabilities {
  const isCurrent = branch.name === repo.data.currentBranch
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktree?.path && !isProtected
  const worktreeState = getBranchWorktreeState(repo, branch)
  const canRemoveWorktree = !!branch.worktree?.path && !worktreeState?.isMain
  const canCopyPatch = !!branch.worktree?.path && (worktreeState?.dirty ?? false)
  return {
    canRemoveWorktree,
    isRegularBranch,
    canCopyPatch,
    canPull: !!branch.tracking,
    canPush: repo.remote.hasRemotes === true,
    canOpenRemote: repo.remote.hasBrowserRemote === true || repo.remote.hasGitHubRemote === true,
    canOpenTerminal: !!branch.worktree?.path,
    canOpenEditor: !!branch.worktree?.path,
  }
}

/**
 * Per-(repoId, branchName) request surface — capabilities and the
 * "request" actions that open a confirm dialog. Dialog state itself
 * lives in `useBranchActionDialogsStore` so it survives the surface
 * that requested it; see `BranchActionDialogHost` for the
 * workspace-level render point and `branchActionDispatch` for the
 * dispatch functions the dialog uses to commit a confirmed action.
 */
export function useBranchActions(repo: BranchActionRepo, branch: RepoBranchState) {
  const setLastResult = useReposStore((s) => s.setLastResult)
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const branchActionBusy = isBranchActionBlocked(repo)
  const branchBusyAction = branchActionBusyItemId(repo, branch.name)
  const {
    pending: pendingLocalAction,
    hasPending: hasPendingLocalAction,
    run: runPendingLocalAction,
  } = useAsyncPending<LocalBranchActionItemId>()

  function guardBusy(): boolean {
    return branchActionBusy || hasPendingLocalAction()
  }

  function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ): void {
    if (guardBusy()) return
    void dispatchRepoBranchAction(repo.id, repo.instanceToken, action, runBranchAction, {
      deferResultMessages: options?.deferResultMessages,
      handleResult: options?.handleResult,
    })
  }

  function runUiAction(
    op: LocalBranchActionItemId,
    fn: () => Promise<ExecResult>,
    options?: { handleResult?: (result: ExecResult) => boolean },
  ): Promise<ExecResult | null> {
    if (guardBusy()) return Promise.resolve(null)
    const pending = runPendingLocalAction(op, async () => {
      const result = await dispatchRepoUiAction(repo.id, repo.instanceToken, op, fn, setLastResult, {
        silentSuccessOps: SILENT_SUCCESS_OPS,
        handleResult: options?.handleResult,
      })
      return result
    })
    // useAsyncPending.run returns Promise<unknown>; the inner async fn
    // above is statically known to resolve to ExecResult | null, so
    // narrow once.
    return (pending ?? Promise.resolve(null)) as Promise<ExecResult | null>
  }

  function copyPatch(): Promise<boolean> {
    const worktreePath = branch.worktree?.path
    if (!worktreePath) return Promise.resolve(false)
    return runUiAction('copyPatch', async () => {
      const result = await getRepositoryPatch(repo.id, worktreePath)
      if (!result.ok) return { ok: false, message: result.message }
      if (!result.message) return { ok: false, message: 'status.copy-patch-empty' }
      try {
        await navigator.clipboard.writeText(result.message)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      return { ok: true, message: 'status.copy-patch-ok' }
    }).then((result) => result?.ok ?? false)
  }

  function pull() {
    runRepoAction({ kind: 'pull', branch: branch.name, worktreePath: branch.worktree?.path })
  }

  function push() {
    if (guardBusy()) return
    if (isPushProtected(branch.name)) {
      // Open the protected-branch confirm dialog through the central
      // store. State outlives any temporary surface (e.g. focus-mode
      // HoverCard popover), so the dialog stays open even after the
      // trigger surface unmounts. The dialog's Confirm button calls
      // `dispatchPush` from `branchActionDispatch` to commit.
      useBranchActionDialogsStore.getState().openPushConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      return
    }
    runRepoAction({ kind: 'push', branch: branch.name })
  }

  function openTerminal() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree.path
    if (remoteRepoTarget(repo.id, repo.remote.lifecycle)) {
      return runUiAction('terminal', () => openRemoteRepositoryTerminal(repo.id, worktreePath))
    }
    return runUiAction('terminal', () => openRepositoryTerminal(worktreePath))
  }

  function openEditor() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree.path
    if (remoteRepoTarget(repo.id, repo.remote.lifecycle)) {
      return runUiAction('editor', () => openRemoteRepositoryEditor(repo.id, worktreePath))
    }
    return runUiAction('editor', () => openRepositoryEditor(worktreePath))
  }

  function openRemote() {
    return runUiAction('remote', () => openBranchExternalTarget(repo.id, branch))
  }

  function requestDeleteBranch() {
    if (guardBusy()) return
    useBranchActionDialogsStore.getState().openDeleteConfirm({
      repoId: repo.id,
      branchName: branch.name,
      payload: branch.name,
    })
  }

  function requestRemoveWorktree() {
    if (guardBusy() || !branch.worktree?.path) return
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: repo.id,
        branchName: branch.name,
        payload: { branch: branch.name, path: branch.worktree.path },
      },
      { isProtectedBranch: PROTECTED_BRANCHES.has(branch.name) },
    )
  }

  const capabilities = getBranchActionCapabilities(repo, branch)

  return {
    blocked: branchActionBusy || pendingLocalAction !== null,
    busyAction: pendingLocalAction ?? branchBusyAction,
    capabilities,
    actions: {
      copyPatch,
      pull,
      push,
      openTerminal,
      openEditor,
      openRemote,
      requestDeleteBranch,
      requestRemoveWorktree,
    },
  }
}