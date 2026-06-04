// Active-repo body. Header (name + path + actions) sits above a
// persistent branch list plus selected-branch detail area.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { BranchList } from '#/web/components/BranchList.tsx'
import { BranchDetail } from '#/web/components/BranchDetail.tsx'
import { RepoToolbar } from '#/web/components/repo-toolbar/RepoToolbar.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { effectiveWorkspaceLayout, repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'

interface Props {
  repoId: string
}

export function RepoView({ repoId }: Props) {
  const uiMode = useResponsiveUiMode()
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const presentation = getRepoWorkspacePresentation(repo)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        detailCollapsed: s.detailCollapsed,
        detailFocusMode: s.detailFocusMode,
        workspaceLayout: s.workspaceLayout,
        detailPaneSizes: s.detailPaneSizes,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.detailCollapsed === b.detailCollapsed &&
      a.detailFocusMode === b.detailFocusMode &&
      a.workspaceLayout === b.workspaceLayout &&
      a.detailPaneSizes['top-bottom'] === b.detailPaneSizes['top-bottom'] &&
      a.detailPaneSizes['left-right'] === b.detailPaneSizes['left-right'],
  )
  const setDetailPaneSize = useReposStore((s) => s.setDetailPaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const layout = effectiveWorkspaceLayout(view.workspaceLayout, uiMode)
  const behavior = repoWorkspaceBehavior(layout, view.detailCollapsed, view.detailFocusMode)
  const detailPaneSize = view.detailPaneSizes[layout]

  if (!view.exists || !repo) return <div />
  if (repo.availability.phase === 'unavailable') return <UnavailableRepoView repo={repo} />
  if (view.initialLoading) {
    return <RepoWorkspaceSkeleton showRepoToolbar layout={layout} detailCollapsed={behavior.detailCollapsed} />
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoToolbar repoId={repoId} />

      <RepoWorkspace
        layout={layout}
        mode={behavior.mode}
        detailSize={detailPaneSize}
        onDetailSizeChange={(size) => setDetailPaneSize(layout, size)}
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
              layout={layout}
              collapsed={behavior.detailCollapsed}
              focusMode={behavior.detailFocusMode}
            />
          </RepoWorkspacePane>
        }
      />
    </section>
  )
}
