// Active-repo body. Header (name + path + actions) sits above a
// persistent branch list plus selected-branch detail area.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { BranchDetail } from '#/renderer/components/BranchDetail.tsx'
import { CommitDetail } from '#/renderer/components/CommitDetail.tsx'
import { RepoToolbar } from '#/renderer/components/repo-toolbar/RepoToolbar.tsx'
import { RepoWorkspaceSkeleton } from '#/renderer/components/Skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane } from '#/renderer/components/Layout.tsx'
import { useRepoToasts } from '#/renderer/hooks/useRepoToasts.tsx'

interface Props {
  repoId: string
}

export function RepoView({ repoId }: Props) {
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        exists: !!repo,
        initialLoading: !!repo && repo.async.loading && repo.data.branches.length === 0,
        openCommit: repo?.ui.openCommit ?? null,
        detailCollapsed: s.detailCollapsed,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.openCommit === b.openCommit &&
      a.detailCollapsed === b.detailCollapsed,
  )
  useRepoToasts(repoId)

  if (!view.exists) return <div />
  if (view.initialLoading) return <RepoWorkspaceSkeleton showRepoToolbar detailCollapsed={view.detailCollapsed} />

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoToolbar repoId={repoId} />

      <RepoWorkspace detailCollapsed={view.detailCollapsed && !view.openCommit}>
        <RepoWorkspacePane border>
          <BranchList repoId={repoId} />
        </RepoWorkspacePane>
        <RepoWorkspacePane>
          {view.openCommit ? (
            <CommitDetail repoId={repoId} detail={view.openCommit} />
          ) : (
            <BranchDetail repoId={repoId} collapsed={view.detailCollapsed} />
          )}
        </RepoWorkspacePane>
      </RepoWorkspace>
    </section>
  )
}
