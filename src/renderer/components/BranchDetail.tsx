import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { getSelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'
import { BranchDetailToolbar } from '#/renderer/components/branch-detail/BranchDetailToolbar.tsx'
import { BranchDetailContent } from '#/renderer/components/branch-detail/BranchDetailContent.tsx'

interface Props {
  repoId: string
  collapsed?: boolean
}

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
      a.data.logsByBranch === b.data.logsByBranch &&
      a.data.status === b.data.status &&
      a.async.statusLoading === b.async.statusLoading &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.async.statusError === b.async.statusError &&
      a.ui.detailTab === b.ui.detailTab)
  )
}

export function BranchDetail({ repoId, collapsed = false }: Props) {
  const detailId = useId()
  const repo = useStoreWithEqualityFn(useReposStore, (s) => s.repos[repoId], branchDetailRepoEqual)
  if (!repo) return null

  const detail = getSelectedBranchDetail(repo)
  const contentId = `${detailId}-content`

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <BranchDetailToolbar
        repo={repo}
        detail={detail}
        detailId={detailId}
        contentId={contentId}
        collapsed={collapsed}
      />
      {!collapsed && <BranchDetailContent repo={repo} detail={detail} detailId={detailId} contentId={contentId} />}
    </section>
  )
}
