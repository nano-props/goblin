import { computed, reactive, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { RepoServerOperationState, RepoSnapshot } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, WorktreeStatus } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import {
  useRepoOperationsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import {
  EMPTY_CHECKBOXES,
  branchActionDialogsStore,
  branchCheckboxKey,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type { BranchActionDialogEntry, BranchCheckboxState } from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'

type BranchActionDialogRepo = BranchActionRepo

export interface BranchActionDialogRepoShell {
  id: WorkspaceId
  workspaceRuntimeId: string
  branchAction: RepoOperationState
  remoteLifecycle: BranchActionRepo['remoteLifecycle']
}

export interface BranchActionDialogTarget<P> {
  entry: BranchActionDialogEntry<P>
  repo: BranchActionDialogRepoShell
}

interface BranchActionDialogContext {
  repo: BranchActionDialogRepo
  branch: BranchSnapshotInfo
}

export interface BranchActionDialogDisplay<P> {
  entry: BranchActionDialogEntry<P>
  liveContext: BranchActionDialogContext | null
  displayContext: BranchActionDialogContext | null
  displayCheckboxes: Readonly<BranchCheckboxState>
}

/**
 * Read model for one mounted dialog owner. The caller guarantees a concrete
 * Git runtime; component lifetime, rather than a disabled placeholder query,
 * expresses whether a dialog needs these subscriptions.
 */
export function useBranchActionDialogDisplay<P>(
  target: MaybeRefOrGetter<BranchActionDialogTarget<P>>,
  open: MaybeRefOrGetter<boolean>,
): BranchActionDialogDisplay<P> {
  const snapshotReadModel = useRepoSnapshotReadModel(
    () => toValue(target).repo.id,
    () => toValue(target).repo.workspaceRuntimeId,
  )
  const statusReadModel = useRepoWorktreeStatusReadModel(
    () => toValue(target).repo.id,
    () => toValue(target).repo.workspaceRuntimeId,
  )
  const operationsReadModel = useRepoOperationsReadModel(
    () => toValue(target).repo.id,
    () => toValue(target).repo.workspaceRuntimeId,
  )
  const liveContext = computed(() => {
    const currentTarget = toValue(target)
    return resolveContext(
      currentTarget.repo,
      currentTarget.entry,
      snapshotReadModel.data.value?.snapshot,
      statusReadModel.data.value?.status,
      operationsReadModel.data.value?.operations,
    )
  })
  let closingContext: BranchActionDialogContext | null = null
  const displayContext = computed(() => {
    if (!toValue(open)) return closingContext
    closingContext = liveContext.value
    return closingContext
  })
  const checkboxStateByBranch = useStoreSelector(branchActionDialogsStore, (state) => state.checkboxStateByBranch)
  const displayCheckboxes = computed(() => {
    const { entry } = toValue(target)
    return checkboxStateByBranch.value[branchCheckboxKey(entry.repoId, entry.branchName)] ?? EMPTY_CHECKBOXES
  })
  const entry = computed(() => toValue(target).entry)
  return reactive({ entry, liveContext, displayContext, displayCheckboxes })
}

function resolveContext<P>(
  repoShell: BranchActionDialogRepoShell,
  entry: BranchActionDialogEntry<P>,
  snapshot: RepoSnapshot | undefined,
  status: WorktreeStatus[] | undefined,
  operations: readonly RepoServerOperationState[] | undefined,
): BranchActionDialogContext | null {
  if (!snapshot) return null
  const repo: BranchActionDialogRepo = {
    id: repoShell.id,
    workspaceRuntimeId: repoShell.workspaceRuntimeId,
    snapshot,
    status,
    branchAction: projectBranchActionOperation(repoShell.branchAction, operations, entry.branchName),
    remoteLifecycle: repoShell.remoteLifecycle,
  }
  const branch = repo.snapshot.branches.find((candidate) => candidate.name === entry.branchName)
  return branch ? { repo, branch } : null
}
