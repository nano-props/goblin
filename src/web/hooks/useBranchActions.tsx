import { useMutation } from '@tanstack/react-query'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { RepoBranchState } from '#/web/stores/workspaces/types.ts'
import type { ExecResult } from '#/web/types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { getRepoPatch, openRepoEditor, openRepoInFinder, openRepoTerminal } from '#/web/repo-client.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { getBranchWorktreeState } from '#/web/stores/workspaces/worktree-state.ts'
import {
  dispatchRepoBranchAction,
  dispatchRepoUiAction,
  isPushProtected,
} from '#/web/stores/workspaces/branch-action-write-paths.ts'
import { useBranchActionDialogsStore } from '#/web/stores/workspaces/branch-action-dialogs.ts'
import {
  branchActionBusyItemId,
  type BranchActionRepo,
  isBranchActionBlocked,
  type BranchActionItemId,
} from '#/web/hooks/branch-action-state.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'

export type { BranchActionItemId } from '#/web/hooks/branch-action-state.ts'

const SILENT_SUCCESS_OPS = new Set<string>(['terminal', 'editor', 'finder'])
type BranchUiActionOpId = 'copyPatch' | 'terminal' | 'editor' | 'finder'

export interface BranchActionCapabilities {
  canRemoveWorktree: boolean
  isRegularBranch: boolean
  canCopyPatch: boolean
  canPull: boolean
  canPush: boolean
  canOpenTerminal: boolean
  canOpenEditor: boolean
  canOpenFinder: boolean
}

export interface BranchActions {
  blocked: boolean
  busyAction: BranchUiActionOpId | BranchActionItemId | null
  capabilities: BranchActionCapabilities
  actions: {
    copyPatch: () => Promise<boolean>
    pull: () => void
    push: () => void
    openTerminal: (app: TerminalApp) => Promise<ExecResult | null> | undefined
    openEditor: (app: EditorApp) => Promise<ExecResult | null> | undefined
    openFinder: () => Promise<ExecResult | null> | undefined
    requestDeleteBranch: () => void
    requestRemoveWorktree: () => void
  }
}

export function getBranchActionCapabilities(repo: BranchActionRepo, branch: RepoBranchState): BranchActionCapabilities {
  const isCurrent = branch.name === repo.branchModel.currentBranch
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktree?.path && !isProtected
  const worktreeState = getBranchWorktreeState(repo, branch)
  const canRemoveWorktree = !!branch.worktree?.path && !worktreeState?.isMain
  const canCopyPatch = !!branch.worktree?.path && (worktreeState?.dirty ?? false)
  const hasWorktree = !!branch.worktree?.path
  const isRemoteRepo = isRemoteWorkspaceId(repo.id)
  return {
    canRemoveWorktree,
    isRegularBranch,
    canCopyPatch,
    canPull: !!branch.tracking,
    canPush: repo.remote.hasRemotes === true,
    canOpenTerminal: hasWorktree,
    canOpenEditor: hasWorktree,
    canOpenFinder: hasWorktree && !isRemoteRepo,
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
export function useBranchActions(repo: BranchActionRepo, branch: RepoBranchState): BranchActions {
  const setLastResult = useWorkspacesStore((s) => s.setLastResult)
  const runBranchAction = useWorkspacesStore((s) => s.runBranchAction)
  const copyPatchMutation = useMutation({
    mutationKey: ['repo-data', repo.id, repo.workspaceRuntimeId, 'patch'],
    mutationFn: async (worktreePath: string) => await getRepoPatch(repo.id, repo.workspaceRuntimeId, worktreePath),
  })
  const branchActionBusy = isBranchActionBlocked(repo)
  const branchBusyAction = branchActionBusyItemId(repo, branch.name)
  const localActionScopeKey = workspacePaneTabsTargetIdentityKey(
    requiredGitWorkspacePaneTabsTarget(repo.id, branch.name, branch.worktree?.path ?? null),
  )
  const {
    pending: pendingLocalAction,
    hasPending: hasPendingLocalAction,
    run: runPendingLocalAction,
  } = useAsyncPending<BranchUiActionOpId>({ resetKey: localActionScopeKey })

  function guardBusy(): boolean {
    return branchActionBusy || hasPendingLocalAction()
  }

  function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ): void {
    if (guardBusy()) return
    void dispatchRepoBranchAction(repo.id, repo.workspaceRuntimeId, action, runBranchAction, {
      deferResultMessages: options?.deferResultMessages,
      handleResult: options?.handleResult,
    })
  }

  function runUiAction(
    op: BranchUiActionOpId,
    fn: () => Promise<ExecResult>,
    options?: { handleResult?: (result: ExecResult) => boolean },
  ): Promise<ExecResult | null> {
    if (guardBusy()) return Promise.resolve(null)
    const pending = runPendingLocalAction(op, async () => {
      const result = await dispatchRepoUiAction(repo.id, repo.workspaceRuntimeId, op, fn, setLastResult, {
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
      const result = await copyPatchMutation.mutateAsync(worktreePath)
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
      // store. State outlives any temporary surface (e.g. zen-mode
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

  function openTerminal(app: TerminalApp) {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree.path
    return runUiAction('terminal', () => openRepoTerminal(repo.id, repo.workspaceRuntimeId, worktreePath, app))
  }

  function openEditor(app: EditorApp) {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree.path
    return runUiAction('editor', () => openRepoEditor(repo.id, repo.workspaceRuntimeId, worktreePath, app))
  }

  function openFinder() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree.path
    if (isRemoteWorkspaceId(repo.id)) return
    return runUiAction('finder', () => openRepoInFinder(repo.id, worktreePath))
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
      openFinder,
      requestDeleteBranch,
      requestRemoveWorktree,
    },
  }
}
