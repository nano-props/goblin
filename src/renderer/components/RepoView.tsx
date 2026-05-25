// Active-repo body. Header (name + path + actions) sits above a
// persistent branch list plus selected-branch detail area.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { BranchDetail } from '#/renderer/components/BranchDetail.tsx'
import { RepoToolbar } from '#/renderer/components/repo-toolbar/RepoToolbar.tsx'
import { RepoWorkspaceSkeleton } from '#/renderer/components/Skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane } from '#/renderer/components/Layout.tsx'
import { useRepoToasts } from '#/renderer/hooks/useRepoToasts.tsx'
import { operationBusy } from '#/renderer/stores/repos/operations.ts'
import { repoWorkspaceBehavior } from '#/renderer/lib/workspace-layout.ts'

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
        initialLoading: !!repo && operationBusy(repo.ops.snapshot) && repo.data.branches.length === 0,
        detailCollapsed: s.detailCollapsed,
        detailFocusMode: s.detailFocusMode,
        workspaceLayout: s.workspaceLayout,
        detailPaneSize: s.detailPaneSizes[s.workspaceLayout],
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.detailCollapsed === b.detailCollapsed &&
      a.detailFocusMode === b.detailFocusMode &&
      a.workspaceLayout === b.workspaceLayout &&
      a.detailPaneSize === b.detailPaneSize,
  )
  const setDetailPaneSize = useReposStore((s) => s.setDetailPaneSize)
  useRepoToasts(repoId)

  const behavior = repoWorkspaceBehavior(view.workspaceLayout, view.detailCollapsed, view.detailFocusMode)

  if (!view.exists) return <div />
  if (view.initialLoading) {
    return (
      <RepoWorkspaceSkeleton showRepoToolbar layout={view.workspaceLayout} detailCollapsed={behavior.detailCollapsed} />
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoToolbar repoId={repoId} />

      <RepoWorkspace
        layout={view.workspaceLayout}
        mode={behavior.mode}
        detailSize={view.detailPaneSize}
        onDetailSizeChange={(size) => setDetailPaneSize(view.workspaceLayout, size)}
        branchPane={
          <RepoWorkspacePane>
            <BranchList
              repoId={repoId}
              showActions={behavior.branchListActionsVisible}
              // Focus mode pins the selected branch as a strip so the detail pane can use the remaining space.
              variant={behavior.mode === 'focus' ? 'selected-strip' : 'list'}
            />
          </RepoWorkspacePane>
        }
        detailPane={
          <RepoWorkspacePane>
            <BranchDetail
              repoId={repoId}
              layout={view.workspaceLayout}
              collapsed={behavior.detailCollapsed}
              focusMode={behavior.detailFocusMode}
            />
          </RepoWorkspacePane>
        }
      />
    </section>
  )
}
