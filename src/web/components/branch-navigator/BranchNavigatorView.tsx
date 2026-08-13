// Single source of truth for the persistent and zen-mode branch navigator.

import { computed, defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { BranchNavigatorSkeleton } from '#/web/components/Skeleton.tsx'
import { BranchNavigatorList } from '#/web/components/branch-navigator/BranchNavigatorList.tsx'
import { useBranchNavigatorReadModel } from '#/web/components/branch-navigator/use-branch-navigator-data.ts'
import type { BranchNavigatorRepoShell } from '#/web/components/branch-navigator/use-branch-navigator-data.ts'
import { repoQueryReadFailure } from '#/web/repo-read-failure.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { branchViewModeForWorkspace } from '#/web/stores/workspaces/branch-view-mode.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { gitWorktreePaneTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { branchNavigatorRows } from '#/web/components/branch-navigator/branch-navigator-model.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
  currentWorktreePath?: string | null
  onAfterSelect?: (branch: string) => void
  onAfterOpenStatus?: (branch: string) => void
}

export const BranchNavigatorView = defineComponent<Props>({
  name: 'BranchNavigatorView',
  props: ['repoId', 'onSelectBranch', 'currentBranchName', 'currentWorktreePath', 'onAfterSelect', 'onAfterOpenStatus'],

  setup(props) {
    const storeProjection = useStoreSelector(
      workspacesStore,
      (state) => ({
        workspaces: state.workspaces,
        branchViewModeByWorkspace: state.branchViewModeByWorkspace,
      }),
      (left, right) =>
        left.workspaces === right.workspaces && left.branchViewModeByWorkspace === right.branchViewModeByWorkspace,
    )
    const repo = computed<BranchNavigatorRepoShell | null>(() => {
      const workspace = storeProjection.value.workspaces[props.repoId]
      return workspace?.capability.kind === 'git'
        ? {
            id: workspace.id,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            branchViewMode: branchViewModeForWorkspace(storeProjection.value.branchViewModeByWorkspace, workspace.id),
            branchAction: workspace.capability.git.operations.branchAction,
            remoteLifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
          }
        : null
    })

    return () =>
      repo.value ? (
        <BranchNavigatorViewReadModel
          repo={repo.value}
          onSelectBranch={props.onSelectBranch}
          currentBranchName={props.currentBranchName}
          currentWorktreePath={props.currentWorktreePath}
          onAfterSelect={props.onAfterSelect}
          onAfterOpenStatus={props.onAfterOpenStatus}
        />
      ) : (
        <BranchNavigatorSkeleton />
      )
  },
})

interface BranchNavigatorViewReadModelProps extends Omit<Props, 'repoId'> {
  repo: BranchNavigatorRepoShell
}

const BranchNavigatorViewReadModel = defineComponent<BranchNavigatorViewReadModelProps>({
  name: 'BranchNavigatorViewReadModel',
  inheritAttrs: false,
  props: ['repo', 'onSelectBranch', 'currentBranchName', 'currentWorktreePath', 'onAfterSelect', 'onAfterOpenStatus'],
  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const { repo, snapshotReadModel, statusReadModel } = useBranchNavigatorReadModel(() => props.repo)
    const rows = computed(() => {
      if (!repo.value) return []
      return branchNavigatorRows({
        branches: repo.value.snapshot.branches,
        worktrees: repo.value.snapshot.worktrees,
        viewMode: repo.value.branchViewMode,
      })
    })
    const highlightedBranch = computed(() => {
      if (props.currentBranchName) return props.currentBranchName
      const currentWorktree = repo.value?.snapshot.worktrees.find(
        (worktree) => worktree.path === props.currentWorktreePath,
      )
      return currentWorktree?.head.kind === 'branch' ? currentWorktree.head.branchName : null
    })

    function selectBranch(branch: string): void {
      if (props.onSelectBranch) props.onSelectBranch(branch)
      else navigation.selectRepoBranch(props.repo.id, branch)
      props.onAfterSelect?.(branch)
    }

    function openBranchStatus(branchName: string): void {
      void dispatchShowWorkspacePaneStaticTabAction({
        workspaceId: props.repo.id,
        branchName,
        type: 'status',
        workspacePaneRoute: undefined,
        navigation,
      })
      props.onAfterOpenStatus?.(branchName)
    }

    function selectWorktree(worktreePath: string): void {
      navigation.selectRepoWorktree(props.repo.id, worktreePath)
    }

    function openWorktreeStatus(worktreePath: string): void {
      const target = gitWorktreePaneTargetLease(props.repo.id, props.repo.workspaceRuntimeId, worktreePath)
      void navigation.commitFilesystemWorkspacePaneRoute(target, { kind: 'static', tab: 'status' })
    }

    function retryStatus(): void {
      void refreshRepoWorktreeStatus({ get: workspacesStore.getState }, props.repo.id, props.repo.workspaceRuntimeId)
    }

    return () => {
      const currentRepo = repo.value
      const snapshotError = snapshotReadModel.error.value
      const snapshotErrorKey =
        snapshotError instanceof Error ? snapshotError.message : snapshotError ? String(snapshotError) : null

      if (!currentRepo && snapshotReadModel.isError.value) {
        return (
          <RepoStatusFailureView
            messageKey={snapshotErrorKey ?? 'error.failed-read-repo'}
            retrying={snapshotReadModel.isFetching.value}
            onRetry={() => void snapshotReadModel.refetch()}
          />
        )
      }
      if (!currentRepo) return <BranchNavigatorSkeleton />

      const readFailures = [
        repoQueryReadFailure(
          {
            isError: snapshotReadModel.isError.value,
            error: snapshotReadModel.error.value,
            isFetching: snapshotReadModel.isFetching.value,
            data: snapshotReadModel.data.value,
          },
          () => void snapshotReadModel.refetch(),
        ),
        repoQueryReadFailure(
          {
            isError: statusReadModel.isError.value,
            error: statusReadModel.error.value,
            isFetching: statusReadModel.isFetching.value,
            data: statusReadModel.data.value,
          },
          retryStatus,
        ),
      ].filter((failure) => failure !== null)
      const emptyLabelKey = currentRepo.snapshot.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'

      return (
        <>
          <RepoReadNotice failures={readFailures} />
          <BranchNavigatorList
            repo={currentRepo}
            rows={rows.value}
            highlightedBranch={highlightedBranch.value}
            highlightedWorktreePath={props.currentWorktreePath ?? null}
            onSelectBranch={selectBranch}
            onOpenBranchStatus={openBranchStatus}
            onSelectWorktree={selectWorktree}
            onOpenWorktreeStatus={openWorktreeStatus}
            emptyState={<EmptyState title={t(emptyLabelKey)} />}
          />
        </>
      )
    }
  },
})
