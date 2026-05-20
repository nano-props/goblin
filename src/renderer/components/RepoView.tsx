// Active-repo body. Header (name + path + actions) sits above a
// persistent branch list plus selected-branch detail area.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { BranchDetail } from '#/renderer/components/BranchDetail.tsx'
import { CommitDetail } from '#/renderer/components/CommitDetail.tsx'
import { RepoToolbar } from '#/renderer/components/RepoToolbar.tsx'
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
        initialLoading: !!repo && repo.loading && repo.branches.length === 0,
        openCommit: repo?.openCommit ?? null,
      }
    },
    (a, b) => a.exists === b.exists && a.initialLoading === b.initialLoading && a.openCommit === b.openCommit,
  )
  useRepoToasts(repoId)

  if (!view.exists) return <div />
  if (view.initialLoading) return <RepoWorkspaceSkeleton showRepoToolbar />

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoToolbar repoId={repoId} />

      <RepoWorkspace>
        <RepoWorkspacePane border>
          <BranchList repoId={repoId} />
        </RepoWorkspacePane>
        <RepoWorkspacePane>
          {view.openCommit ? (
            <CommitDetail repoId={repoId} detail={view.openCommit} />
          ) : (
            <BranchDetail repoId={repoId} />
          )}
        </RepoWorkspacePane>
      </RepoWorkspace>
    </section>
  )
}
