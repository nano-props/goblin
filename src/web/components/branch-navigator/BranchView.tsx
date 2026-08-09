// Single source of truth for the persistent and zen-mode branch lists.

import { computed, defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { BranchNavigatorSkeleton } from '#/web/components/Skeleton.tsx'
import { BranchList } from '#/web/components/branch-navigator/BranchList.tsx'
import { useBranchListReadModel } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import type { BranchListRepoShell } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import { repoQueryReadFailure } from '#/web/repo-read-failure.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { branchViewModeForWorkspace, visibleBranches } from '#/web/stores/workspaces/branch-view-mode.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
  onAfterSelect?: (branch: string) => void
  onAfterOpenStatus?: (branch: string) => void
}

export const BranchView = defineComponent<Props>({
  name: 'BranchView',
  props: ['repoId', 'onSelectBranch', 'currentBranchName', 'onAfterSelect', 'onAfterOpenStatus'],

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
    const repo = computed<BranchListRepoShell | null>(() => {
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
        <BranchViewReadModel
          repo={repo.value}
          onSelectBranch={props.onSelectBranch}
          currentBranchName={props.currentBranchName}
          onAfterSelect={props.onAfterSelect}
          onAfterOpenStatus={props.onAfterOpenStatus}
        />
      ) : (
        <BranchNavigatorSkeleton />
      )
  },
})

interface BranchViewReadModelProps extends Omit<Props, 'repoId'> {
  repo: BranchListRepoShell
}

const BranchViewReadModel = defineComponent<BranchViewReadModelProps>({
  name: 'BranchViewReadModel',
  inheritAttrs: false,
  props: ['repo', 'onSelectBranch', 'currentBranchName', 'onAfterSelect', 'onAfterOpenStatus'],
  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const { repo, snapshotReadModel, statusReadModel } = useBranchListReadModel(() => props.repo)
    const branches = computed(() =>
      repo.value
        ? visibleBranches({
            branches: repo.value.snapshot.branches,
            viewMode: repo.value.branchViewMode,
          })
        : [],
    )

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
          <BranchList
            repo={currentRepo}
            branches={branches.value}
            highlightedBranch={props.currentBranchName ?? null}
            onSelectBranch={selectBranch}
            onOpenBranchStatus={openBranchStatus}
            emptyState={<EmptyState title={t(emptyLabelKey)} />}
          />
        </>
      )
    }
  },
})
