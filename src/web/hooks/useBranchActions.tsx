import { useState } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { BranchActionDialogs, type RemoveConfirm } from '#/web/components/BranchActionDialogs.tsx'
import type { ExecResult } from '#/web/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import {
  getRepositoryPatch,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
} from '#/web/repo-client.ts'
import { openRemoteRepositoryEditor, openRemoteRepositoryTerminal } from '#/web/remote-client.ts'
import {
  branchActionBusyItemId,
  type BranchActionRepo,
  isBranchActionBlocked,
  type BranchActionItemId,
} from '#/web/hooks/branch-action-state.ts'
import { openBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'
import { getBranchWorktreeState } from '#/web/stores/repos/worktree-state.ts'
import {
  deleteBranchNeedsForceConfirm,
  dispatchRepoBranchAction,
  dispatchRepoUiAction,
  isPushProtected,
  removeWorktreeNeedsForceConfirm,
} from '#/web/stores/repos/branch-action-write-paths.ts'

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
  const pushConfirm = useRetainedDialogState<string>()
  const deleteConfirm = useRetainedDialogState<string>()
  const forceDeleteConfirm = useRetainedDialogState<string>()
  const removeConfirm = useRetainedDialogState<RemoveConfirm>()
  const forceRemoveConfirm = useRetainedDialogState<RemoveConfirm>()
  const [removeAlsoDeletes, setRemoveAlsoDeletes] = useState(true)
  const [deleteAlsoUpstream, setDeleteAlsoUpstream] = useState(false)
  const [removeAlsoUpstream, setRemoveAlsoUpstream] = useState(false)
  const hasUpstream = !!branch.tracking && !branch.trackingGone

  function guardBusy(): boolean {
    return branchActionBusy || hasPendingLocalAction()
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
    // useAsyncPending.run returns Promise<unknown>; the inner async fn above
    // is statically known to resolve to ExecResult | null, so narrow once.
    return (pending ?? Promise.resolve(null)) as Promise<ExecResult | null>
  }

  async function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ) {
    if (guardBusy()) return
    await dispatchRepoBranchAction(repo.id, repo.instanceToken, action, runBranchAction, {
      deferResultMessages: options?.deferResultMessages,
      handleResult: options?.handleResult,
    })
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
    void runRepoAction({ kind: 'pull', branch: branch.name, worktreePath: branch.worktree?.path })
  }

  function push() {
    if (guardBusy()) return
    if (isPushProtected(branch.name)) {
      pushConfirm.openWith(branch.name)
      return
    }
    void runRepoAction({ kind: 'push', branch: branch.name })
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
    setDeleteAlsoUpstream(false)
    deleteConfirm.openWith(branch.name)
  }

  function requestRemoveWorktree() {
    if (guardBusy() || !branch.worktree?.path) return
    setRemoveAlsoDeletes(!PROTECTED_BRANCHES.has(branch.name))
    setRemoveAlsoUpstream(false)
    removeConfirm.openWith({ branch: branch.name, path: branch.worktree.path })
  }

  function deleteBranch(target: string, force = false, alsoDeleteUpstream = false) {
    void runRepoAction(
      { kind: 'deleteBranch', branch: target, force, alsoDeleteUpstream },
      {
        deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
        handleResult: (result) => {
          if (deleteBranchNeedsForceConfirm(result, force)) {
            forceDeleteConfirm.openWith(target)
            return true
          }
          return false
        },
      },
    )
  }

  function removeWorktree(
    target: RemoveConfirm,
    alsoDeleteBranch: boolean,
    forceDeleteBranch: boolean,
    alsoDeleteUpstream = false,
  ) {
    void runRepoAction(
      {
        kind: 'removeWorktree',
        branch: target.branch,
        worktreePath: target.path,
        alsoDeleteBranch,
        forceDeleteBranch,
        alsoDeleteUpstream,
      },
      {
        deferResultMessages: alsoDeleteBranch && !forceDeleteBranch ? ['error.cannot-remove-unpushed-worktree'] : [],
        handleResult: (result) => {
          if (removeWorktreeNeedsForceConfirm(result, alsoDeleteBranch, forceDeleteBranch)) {
            forceRemoveConfirm.openWith(target)
            return true
          }
          return false
        },
      },
    )
  }

  const capabilities = getBranchActionCapabilities(repo, branch)

  const dialogs = (
    <BranchActionDialogs
      branch={branch}
      remoteTarget={remoteRepoTarget(repo.id, repo.remote.lifecycle)}
      hasUpstream={hasUpstream}
      pushConfirm={pushConfirm}
      deleteConfirm={deleteConfirm}
      forceDeleteConfirm={forceDeleteConfirm}
      removeConfirm={removeConfirm}
      forceRemoveConfirm={forceRemoveConfirm}
      deleteAlsoUpstream={deleteAlsoUpstream}
      removeAlsoDeletes={removeAlsoDeletes}
      removeAlsoUpstream={removeAlsoUpstream}
      setDeleteAlsoUpstream={setDeleteAlsoUpstream}
      setRemoveAlsoDeletes={setRemoveAlsoDeletes}
      setRemoveAlsoUpstream={setRemoveAlsoUpstream}
      onPushConfirm={(target) => {
        void runRepoAction({ kind: 'push', branch: target })
      }}
      onDeleteBranch={(target, force, alsoDeleteUpstream) => {
        void deleteBranch(target, force, alsoDeleteUpstream)
      }}
      onRemoveWorktree={(target, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream) => {
        void removeWorktree(target, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream)
      }}
    />
  )

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
    dialogs,
  }
}
