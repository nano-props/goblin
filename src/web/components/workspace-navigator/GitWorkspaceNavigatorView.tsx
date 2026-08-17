// Single source of truth for the persistent and zen-mode Git workspace navigator.

import { computed, defineComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useAppNavigation } from '#/web/app/navigation/context.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { GitWorkspaceNavigatorSkeleton } from '#/web/components/Skeleton.tsx'
import { GitWorkspaceNavigatorList } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorList.tsx'
import { useGitWorkspaceNavigatorReadModel } from '#/web/components/workspace-navigator/use-git-workspace-navigator-data.ts'
import type { GitWorkspaceNavigatorRepoShell } from '#/web/components/workspace-navigator/use-git-workspace-navigator-data.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { branchViewModeForWorkspace } from '#/web/stores/workspaces/branch-view-mode.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  dispatchShowWorkspacePaneStaticTabAction,
  dispatchShowWorkspacePaneTargetStaticTabAction,
} from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { gitBranchPaneTargetLease, gitWorktreePaneTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { workspacePaneLocationForWorktree } from '#/web/workspace-pane/workspace-pane-location.ts'
import { gitWorkspaceNavigatorRows } from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
  currentWorktreePath?: string | null
  onAfterSelect?: (branch: string) => void
  onAfterOpenStatus?: (branch: string) => void
}

export const GitWorkspaceNavigatorView = defineComponent<Props>({
  name: 'GitWorkspaceNavigatorView',
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
    const repo = computed<GitWorkspaceNavigatorRepoShell | null>(() => {
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
        <GitWorkspaceNavigatorViewReadModel
          repo={repo.value}
          onSelectBranch={props.onSelectBranch}
          currentBranchName={props.currentBranchName}
          currentWorktreePath={props.currentWorktreePath}
          onAfterSelect={props.onAfterSelect}
          onAfterOpenStatus={props.onAfterOpenStatus}
        />
      ) : (
        <GitWorkspaceNavigatorSkeleton />
      )
  },
})

interface GitWorkspaceNavigatorViewReadModelProps extends Omit<Props, 'repoId'> {
  repo: GitWorkspaceNavigatorRepoShell
}

const GitWorkspaceNavigatorViewReadModel = defineComponent<GitWorkspaceNavigatorViewReadModelProps>({
  name: 'GitWorkspaceNavigatorViewReadModel',
  inheritAttrs: false,
  props: ['repo', 'onSelectBranch', 'currentBranchName', 'currentWorktreePath', 'onAfterSelect', 'onAfterOpenStatus'],
  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const { repo, snapshotReadModel, statusReadModel } = useGitWorkspaceNavigatorReadModel(() => props.repo)
    const rows = computed(() => {
      if (!repo.value) return []
      return gitWorkspaceNavigatorRows({
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
      else navigation.selectRepoBranch(gitBranchPaneTargetLease(props.repo.id, props.repo.workspaceRuntimeId, branch))
      props.onAfterSelect?.(branch)
    }

    function openBranchStatus(branchName: string): void {
      void dispatchShowWorkspacePaneStaticTabAction({
        workspaceId: props.repo.id,
        workspaceRuntimeId: props.repo.workspaceRuntimeId,
        branchName,
        type: 'status',
        workspacePaneRoute: undefined,
        navigation,
      })
      props.onAfterOpenStatus?.(branchName)
    }

    function selectWorktree(worktreePath: string): void {
      const worktree = repo.value?.snapshot.worktrees.find((candidate) => candidate.path === worktreePath)
      if (!worktree) return
      const context = workspacePaneLocationForWorktree(props.repo.id, props.repo.workspaceRuntimeId, worktree)
      navigation.selectRepoWorktree({
        routeTarget: context.routeTarget,
        workspaceRuntimeId: context.workspaceRuntimeId,
      })
    }

    function openWorktreeStatus(worktreePath: string): void {
      openWorktreeTab(worktreePath, 'status')
    }

    function openWorktreeTab(worktreePath: string, type: WorkspacePaneStaticTabType): void {
      const worktree = repo.value?.snapshot.worktrees.find((candidate) => candidate.path === worktreePath)
      if (!worktree) return
      const location = workspacePaneLocationForWorktree(props.repo.id, props.repo.workspaceRuntimeId, worktree)
      void dispatchShowWorkspacePaneTargetStaticTabAction({
        location,
        type,
        workspacePaneRoute: undefined,
        navigation,
      })
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
      if (!currentRepo) return <GitWorkspaceNavigatorSkeleton />

      const emptyLabelKey = currentRepo.snapshot.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'

      return (
        <GitWorkspaceNavigatorList
          repo={currentRepo}
          rows={rows.value}
          highlightedBranch={highlightedBranch.value}
          highlightedWorktreePath={props.currentWorktreePath ?? null}
          onSelectBranch={selectBranch}
          onOpenBranchStatus={openBranchStatus}
          onSelectWorktree={selectWorktree}
          onOpenWorktreeStatus={openWorktreeStatus}
          onOpenWorktreeTab={openWorktreeTab}
          emptyState={<EmptyState title={t(emptyLabelKey)} />}
        />
      )
    }
  },
})
