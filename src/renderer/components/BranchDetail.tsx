import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState, RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { getSelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'
import { BranchDetailToolbar } from '#/renderer/components/branch-detail/BranchDetailToolbar.tsx'
import { BranchDetailContent } from '#/renderer/components/branch-detail/BranchDetailContent.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'

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
      a.ui.commitDetail === b.ui.commitDetail &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.logsByBranch === b.data.logsByBranch &&
      a.data.status === b.data.status &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.resources.status === b.resources.status &&
      a.resources.logsByBranch === b.resources.logsByBranch &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.resources.branchAction === b.resources.branchAction &&
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
        <BranchDetailContent repo={repo} detail={detail} detailId={detailId} contentId={contentId} layout={layout} />
      )}
    </section>
  )
}
