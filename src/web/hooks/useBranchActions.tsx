import { computed, reactive, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/settings.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { getRepoPatch } from '#/web/repo-client.ts'
import {
  openWorkspaceEditor,
  openWorkspaceInFinder,
  openWorkspaceTerminal,
} from '#/web/workspace-external-app-client.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'
import { branchWorktreeChanges } from '#/web/stores/workspaces/worktree-state.ts'
import { dispatchRepoBranchAction, isPushProtected } from '#/web/stores/workspaces/branch-action-write-paths.ts'
import { dispatchWorkspaceUiAction } from '#/web/stores/workspaces/workspace-ui-action.ts'
import { branchActionDialogsStore } from '#/web/stores/workspaces/branch-action-dialogs.ts'
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
import { useT } from '#/web/stores/i18n-vue.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

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

export function getBranchActionCapabilities(
  repo: BranchActionRepo,
  branch: BranchSnapshotInfo,
): BranchActionCapabilities {
  const isCurrent = branch.name === repo.snapshot.current
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktree?.path && !isProtected
  const worktreeChanges = branchWorktreeChanges(repo.status, branch)
  const canRemoveWorktree = !!branch.worktree && branch.worktree.isPrimary === false
  const canCopyPatch = !!branch.worktree && worktreeChanges?.dirty === true
  const hasWorktree = !!branch.worktree?.path
  const isRemoteRepo = isRemoteWorkspaceId(repo.id)
  return {
    canRemoveWorktree,
    isRegularBranch,
    canCopyPatch,
    canPull: !!branch.tracking,
    canPush: repo.snapshot.remote.hasRemotes,
    canOpenTerminal: hasWorktree,
    canOpenEditor: hasWorktree,
    canOpenFinder: hasWorktree && !isRemoteRepo,
  }
}

/**
 * Per-(repoId, branchName) request surface — capabilities and the
 * "request" actions that open a confirm dialog. Dialog state itself
 * lives in `branchActionDialogsStore` so it survives the surface
 * that requested it; see `BranchActionDialogHost` for the
 * workspace-level render point and `branchActionDispatch` for the
 * dispatch functions the dialog uses to commit a confirmed action.
 */
export function useBranchActions(
  repo: MaybeRefOrGetter<BranchActionRepo>,
  branch: MaybeRefOrGetter<BranchSnapshotInfo>,
): BranchActions {
  const t = useT()
  const { setLastResult, runBranchAction } = workspacesStore.getState()
  const copyPatchMutation = useMutation({
    mutationKey: ['repo-data', 'patch'],
    mutationFn: async (input: { repoId: BranchActionRepo['id']; workspaceRuntimeId: string; worktreePath: string }) =>
      await getRepoPatch(input.repoId, input.workspaceRuntimeId, input.worktreePath),
  })
  const localActionScopeKey = computed(() => {
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    return workspacePaneTabsTargetIdentityKey(
      requiredGitWorkspacePaneTabsTarget(currentRepo.id, currentBranch.name, currentBranch.worktree?.path ?? null),
    )
  })
  const { pending, hasPending, run } = useAsyncPending<BranchUiActionOpId>({
    resetKey: localActionScopeKey,
  })

  function guardBusy(): boolean {
    return isBranchActionBlocked(toValue(repo)) || hasPending()
  }

  function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ): void {
    if (guardBusy()) return
    const currentRepo = toValue(repo)
    void dispatchRepoBranchAction(currentRepo.id, currentRepo.workspaceRuntimeId, action, runBranchAction, {
      deferResultMessages: options?.deferResultMessages,
      handleResult: options?.handleResult,
    })
  }

  function runUiAction(op: BranchUiActionOpId, fn: () => Promise<ExecResult>): Promise<ExecResult | null> {
    if (guardBusy()) return Promise.resolve(null)
    const currentRepo = toValue(repo)
    const request = run(op, async () => {
      return await dispatchWorkspaceUiAction(currentRepo.id, currentRepo.workspaceRuntimeId, op, fn, {
        silentSuccessOps: SILENT_SUCCESS_OPS,
        reportResult: setLastResult,
      })
    })
    return (request ?? Promise.resolve(null)) as Promise<ExecResult | null>
  }

  async function runExternalAppAction(
    op: 'terminal' | 'editor' | 'finder',
    action: () => Promise<ExecResult>,
  ): Promise<ExecResult | null> {
    try {
      return await runUiAction(op, action)
    } catch (error) {
      if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) {
        toast.warning(t('error.external-app-outcome-uncertain'))
        return null
      }
      throw error
    }
  }

  function copyPatch(): Promise<boolean> {
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    const worktreePath = currentBranch.worktree?.path
    if (!worktreePath) return Promise.resolve(false)
    if (!globalThis.navigator?.clipboard?.writeText) {
      if (guardBusy()) return Promise.resolve(false)
      setLastResult(
        currentRepo.id,
        { ok: false, message: 'status.copy-patch-secure-context-required' },
        currentRepo.workspaceRuntimeId,
      )
      return Promise.resolve(false)
    }

    return runUiAction('copyPatch', async () => {
      // Known issue: some browsers require clipboard writes to remain within
      // the original user-activation window, which may expire while this
      // asynchronous patch request runs. We accept that compatibility limit
      // here instead of adding a two-stage generate-then-copy interaction.
      const result = await copyPatchMutation.mutateAsync({
        repoId: currentRepo.id,
        workspaceRuntimeId: currentRepo.workspaceRuntimeId,
        worktreePath,
      })
      if (!result.ok) return { ok: false, message: result.message }
      if (!result.message) return { ok: false, message: 'status.copy-patch-empty' }
      try {
        await copyToClipboard(result.message)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      return { ok: true, message: 'status.copy-patch-ok' }
    }).then((result) => result?.ok ?? false)
  }

  function pull() {
    const currentBranch = toValue(branch)
    runRepoAction({ kind: 'pull', branch: currentBranch.name, worktreePath: currentBranch.worktree?.path })
  }

  function push() {
    if (guardBusy()) return
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    if (isPushProtected(currentBranch.name)) {
      branchActionDialogsStore.getState().openPushConfirm({
        repoId: currentRepo.id,
        branchName: currentBranch.name,
        payload: currentBranch.name,
      })
      return
    }
    runRepoAction({ kind: 'push', branch: currentBranch.name })
  }

  function openTerminal(app: TerminalApp) {
    const currentRepo = toValue(repo)
    const worktreePath = toValue(branch).worktree?.path
    if (!worktreePath) return
    const target = gitWorktreeFilesystemExecutionTarget(currentRepo.id, currentRepo.workspaceRuntimeId, worktreePath)
    if (!target) return
    return runExternalAppAction('terminal', () => openWorkspaceTerminal(target, app))
  }

  function openEditor(app: EditorApp) {
    const currentRepo = toValue(repo)
    const worktreePath = toValue(branch).worktree?.path
    if (!worktreePath) return
    const target = gitWorktreeFilesystemExecutionTarget(currentRepo.id, currentRepo.workspaceRuntimeId, worktreePath)
    if (!target) return
    return runExternalAppAction('editor', () => openWorkspaceEditor(target, app))
  }

  function openFinder() {
    const currentRepo = toValue(repo)
    const worktreePath = toValue(branch).worktree?.path
    if (!worktreePath || isRemoteWorkspaceId(currentRepo.id)) return
    const target = gitWorktreeFilesystemExecutionTarget(currentRepo.id, currentRepo.workspaceRuntimeId, worktreePath)
    if (!target) return
    return runExternalAppAction('finder', () => openWorkspaceInFinder(target))
  }

  function requestDeleteBranch() {
    if (guardBusy()) return
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    branchActionDialogsStore.getState().openDeleteConfirm({
      repoId: currentRepo.id,
      branchName: currentBranch.name,
      payload: currentBranch.name,
    })
  }

  function requestRemoveWorktree() {
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    if (guardBusy() || !currentBranch.worktree?.path) return
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: currentRepo.id,
        branchName: currentBranch.name,
        payload: { branch: currentBranch.name, path: currentBranch.worktree.path },
      },
      { isProtectedBranch: PROTECTED_BRANCHES.has(currentBranch.name) },
    )
  }

  const actions: BranchActions['actions'] = {
    copyPatch,
    pull,
    push,
    openTerminal,
    openEditor,
    openFinder,
    requestDeleteBranch,
    requestRemoveWorktree,
  }

  return reactive({
    get blocked() {
      return isBranchActionBlocked(toValue(repo)) || pending.value !== null
    },
    get busyAction() {
      const currentRepo = toValue(repo)
      return pending.value ?? branchActionBusyItemId(currentRepo, toValue(branch).name)
    },
    get capabilities() {
      return getBranchActionCapabilities(toValue(repo), toValue(branch))
    },
    actions,
  }) as BranchActions
}
