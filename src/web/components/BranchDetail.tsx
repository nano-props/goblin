import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import {
  getSelectedBranchDetailPresentation,
  type SelectedBranchDetailPresentation,
} from '#/web/components/branch-detail/model.ts'
import { BranchDetailToolbar } from '#/web/components/branch-detail/BranchDetailToolbar.tsx'
import { BranchDetailContent } from '#/web/components/branch-detail/BranchDetailContent.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { BranchActionDialogs } from '#/web/components/BranchActionBar.tsx'
interface Props {
  repoId: string
  layout?: RepoWorkspaceLayout
  collapsed?: boolean
  focusMode?: boolean
}

// Keep this equality in sync with fields read by BranchDetail children.
function branchDetailRepoEqual(a: RepoState | undefined, b: RepoState | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.branchViewMode === b.ui.branchViewMode &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.resources.status === b.resources.status &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote === b.remote &&
      a.ui.detailTab === b.ui.detailTab)
  )
}

export function BranchDetail({
  repoId,
  layout = DEFAULT_WORKSPACE_LAYOUT,
  collapsed = false,
  focusMode = false,
}: Props) {
  const detailId = useId()
  const repo = useStoreWithEqualityFn(useReposStore, (s) => s.repos[repoId], branchDetailRepoEqual)
  if (!repo) return null

  const detail = getSelectedBranchDetailPresentation(repo)
  const contentId = `${detailId}-content`

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchDetailWithActions
          key={`${repo.id}:${detail.branch.name}`}
          repo={repo}
          detail={detail}
          branch={detail.branch}
          detailId={detailId}
          contentId={contentId}
          collapsed={collapsed}
          focusMode={focusMode}
          layout={layout}
        />
      ) : (
        <>
          <BranchDetailToolbar
            repo={repo}
            detail={detail}
            detailId={detailId}
            contentId={contentId}
            collapsed={collapsed}
            focusMode={focusMode}
            layout={layout}
          />
          {!collapsed && (
            <BranchDetailContent
              repo={repo}
              detail={detail}
              detailId={detailId}
              contentId={contentId}
              layout={layout}
            />
          )}
        </>
      )}
    </section>
  )
}

interface BranchDetailWithActionsProps {
  repo: RepoState
  detail: SelectedBranchDetailPresentation
  branch: NonNullable<SelectedBranchDetailPresentation['branch']>
  detailId: string
  contentId: string
  collapsed: boolean
  focusMode: boolean
  layout: RepoWorkspaceLayout
}

function BranchDetailWithActions({
  repo,
  detail,
  branch,
  detailId,
  contentId,
  collapsed,
  focusMode,
  layout,
}: BranchDetailWithActionsProps) {
  const actions = useBranchActionItems(repo, branch)

  return (
    <>
      <BranchDetailToolbar
        repo={repo}
        detail={detail}
        detailId={detailId}
        contentId={contentId}
        collapsed={collapsed}
        focusMode={focusMode}
        layout={layout}
        branchActions={actions}
      />
      <BranchActionDialogs actions={actions} />
      {!collapsed && (
        <BranchDetailContent repo={repo} detail={detail} detailId={detailId} contentId={contentId} layout={layout} />
      )}
    </>
  )
}
