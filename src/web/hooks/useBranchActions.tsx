import { useState } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import { BranchActionDialogs, type RemoveConfirm } from '#/web/components/BranchActionDialogs.tsx'
import type { ExecResult } from '#/web/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import {
  getRepositoryPatch,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
} from '#/web/app-data-client.ts'
import {
  branchActionBusyItemId,
  isBranchActionBlocked,
  type BranchActionItemId,
} from '#/web/hooks/branch-action-state.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { useRetainedDialogState } from '#/web/hooks/useRetainedDialogState.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { getBranchWorktreeState } from '#/web/stores/repos/worktree-state.ts'
export type { BranchActionItemId } from '#/web/hooks/branch-action-state.ts'
const SILENT_SUCCESS_OPS = new Set<BranchActionItemId>(['remote', 'terminal', 'editor'])
type LocalBranchActionItemId = 'copyPatch' | 'remote' | 'terminal' | 'editor'

export interface BranchActionCapabilities {
  isCurrent: boolean
  checkedOutInAnotherWorktree: boolean
  canRemoveWorktree: boolean
  isRegularBranch: boolean
  canCopyPatch: boolean
  canPull: boolean
  canPush: boolean
  canOpenRemote: boolean
  canOpenTerminal: boolean
  canOpenEditor: boolean
}

export function getBranchActionCapabilities(repo: RepoState, branch: RepoBranchState): BranchActionCapabilities {
  const isCurrent = branch.name === repo.data.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktree?.path && !isCurrent
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktree?.path && !isProtected
  const worktreeState = getBranchWorktreeState(repo, branch)
  const canRemoveWorktree = checkedOutInAnotherWorktree && !worktreeState?.isMain
  const canCopyPatch = !!branch.worktree?.path && (worktreeState?.dirty ?? false)
  return {
    isCurrent,
    checkedOutInAnotherWorktree,
    canRemoveWorktree,
    isRegularBranch,
    canCopyPatch,
    canPull: !!branch.tracking,
    canPush: repo.remote.hasRemotes === true,
    canOpenRemote: repo.remote.hasBrowserRemote === true || repo.remote.hasGitHubRemote === true,
    canOpenTerminal: !!branch.worktree?.path,
    canOpenEditor: !!branch.worktree?.path && !repo.remote.target,
  }
}

export function useBranchActions(repo: RepoState, branch: RepoBranchState) {
  const navigation = useMainWindowNavigation()
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

  function runUiAction(
    op: LocalBranchActionItemId,
    fn: () => Promise<ExecResult>,
    options?: { handleResult?: (result: ExecResult) => boolean },
  ) {
    if (branchActionBusy || hasPendingLocalAction()) return
    const pending = runPendingLocalAction(op, async () => {
      const token = repo.instanceToken
      let result: ExecResult
      try {
        result = await fn()
      } catch (err) {
        result = { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      if (!result.ok && result.message === 'cancelled') return
      if (options?.handleResult?.(result)) return
      const skipSuccessToast = result.ok && SILENT_SUCCESS_OPS.has(op)
      if (!skipSuccessToast) setLastResult(repo.id, result, token)
    })
    if (pending) return Promise.resolve(pending).then(() => undefined)
  }

  async function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ) {
    if (branchActionBusy || hasPendingLocalAction()) return
    const result = await runBranchAction(repo.id, action, {
      token: repo.instanceToken,
      deferResultMessages: options?.deferResultMessages,
    })
    if (!result || (!result.ok && result.message === 'cancelled')) return
    options?.handleResult?.(result)
  }

  function copyPatch() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
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
    })
  }

  function checkout() {
    return runRepoAction({ kind: 'checkout', branch: branch.name })
  }

  function pull() {
    return runRepoAction({ kind: 'pull', branch: branch.name, worktreePath: branch.worktree?.path })
  }

  function push() {
    if (branchActionBusy || hasPendingLocalAction()) return
    if (PROTECTED_BRANCHES.has(branch.name)) {
      pushConfirm.openWith(branch.name)
      return
    }
    return runRepoAction({ kind: 'push', branch: branch.name })
  }

  function openTerminal() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    if (repo.remote.target) {
      return runUiAction('terminal', async () => {
        navigation.showRepoDetailTab(repo.id, 'terminal')
        return { ok: true, message: '' }
      })
    }
    return runUiAction('terminal', () => openRepositoryTerminal(worktreePath))
  }

  function openEditor() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    return runUiAction('editor', () => openRepositoryEditor(worktreePath))
  }

  function openRemote() {
    return runUiAction('remote', () => openRepositoryRemote(repo.id, branch.name))
  }

  function requestDeleteBranch() {
    if (branchActionBusy || hasPendingLocalAction()) return
    setDeleteAlsoUpstream(false)
    deleteConfirm.openWith(branch.name)
  }

  function requestRemoveWorktree() {
    if (branchActionBusy || hasPendingLocalAction() || !branch.worktree?.path) return
    setRemoveAlsoDeletes(!PROTECTED_BRANCHES.has(branch.name))
    setRemoveAlsoUpstream(false)
    removeConfirm.openWith({ branch: branch.name, path: branch.worktree?.path })
  }

  function deleteBranch(target: string, force = false, alsoDeleteUpstream = false) {
    return runRepoAction(
      { kind: 'deleteBranch', branch: target, force, alsoDeleteUpstream },
      {
        deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
        handleResult: (result) => {
          if (!force && !result.ok && result.message === 'error.branch-not-fully-merged') {
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
    return runRepoAction(
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
          if (
            !result.ok &&
            result.message === 'error.cannot-remove-unpushed-worktree' &&
            alsoDeleteBranch &&
            !forceDeleteBranch
          ) {
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
      remoteTarget={repo.remote.target}
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
      checkout,
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
