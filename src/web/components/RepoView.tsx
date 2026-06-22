// Active-repo body. The per-repo actions (Refresh, worktree
// filter, new worktree) live in the Topbar — see `Topbar.tsx`
// and `App.tsx` — so the workspace below the topbar is just the
// branch navigator and the branch workspace pane.

import { useEffect, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { BranchWorkspace } from '#/web/components/BranchWorkspace.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { CompactRepoWorkspace, RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'

interface Props {
  repoId: string
}

export function RepoView({ repoId }: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const presentation = getRepoWorkspacePresentation(repo)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        workspaceFocused: s.workspaceFocused,
        workspacePaneSizes: s.workspacePaneSizes,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.workspaceFocused === b.workspaceFocused &&
      a.workspacePaneSizes['left-right'] === b.workspacePaneSizes['left-right'],
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const layout = DEFAULT_WORKSPACE_LAYOUT
  const branchWorkspaceActive = !!repo?.ui.selectedBranch
  const behavior = repoWorkspaceBehavior({
    layout,
    compact,
    workspaceFocused: view.workspaceFocused,
    branchWorkspaceActive,
  })

  const workspacePaneSize = view.workspacePaneSizes[layout]
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const selectedBranchOverrideForTransition = useCompactWorkspaceBranchTransitionOverride(selectedBranch, compact)

  if (!view.exists || !repo) return <div />
  if (isRepoUnavailable(repo)) return <UnavailableRepoView repo={repo} />
  if (view.initialLoading) {
    return (
      <RepoWorkspaceSkeleton
        layout={layout}
        singlePane={behavior.singlePane}
        singlePaneView={selectedBranch ? 'workspace' : 'navigator'}
        branchWorkspaceState={selectedBranch ? 'content' : 'empty'}
      />
    )
  }

  const singlePane = repo.ui.selectedBranch ? 'workspace' : 'navigator'
  const branchWorkspacePane = (
    <RepoWorkspacePane>
      <BranchWorkspace
        repoId={repoId}
        selectedBranchOverrideForTransition={selectedBranchOverrideForTransition}
        shortcutsEnabled={!compact || singlePane === 'workspace'}
      />
    </RepoWorkspacePane>
  )
  const branchNavigatorPane = (
    <RepoWorkspacePane>
      <BranchNavigator repoId={repoId} showActions={behavior.branchNavigatorActionsVisible} />
    </RepoWorkspacePane>
  )
  const singlePaneBody = singlePane === 'workspace' ? branchWorkspacePane : branchNavigatorPane

  const workspaceBody = compact ? (
    <CompactRepoWorkspace
      activePane={singlePane}
      branchNavigatorPane={branchNavigatorPane}
      branchWorkspacePane={branchWorkspacePane}
    />
  ) : behavior.singlePane ? (
    singlePaneBody
  ) : (
    <RepoWorkspace
      layout={layout}
      mode="split"
      workspacePaneSize={workspacePaneSize}
      onWorkspacePaneSizeChange={(size) => setWorkspacePaneSize(layout, size)}
      branchNavigatorCollapsed={behavior.branchNavigatorCollapsed}
      branchNavigatorPane={branchNavigatorPane}
      branchWorkspacePane={branchWorkspacePane}
    />
  )

  return <section className="relative flex min-w-0 flex-1 flex-col">{workspaceBody}</section>
}

function useCompactWorkspaceBranchTransitionOverride(
  selectedBranch: string | null,
  compact: boolean,
): string | undefined {
  const previousBranchRef = useRef<string | null>(selectedBranch)
  const [selectedBranchOverride, setSelectedBranchOverride] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!compact) {
      previousBranchRef.current = selectedBranch
      setSelectedBranchOverride(undefined)
      return
    }

    if (selectedBranch) {
      previousBranchRef.current = selectedBranch
      setSelectedBranchOverride(undefined)
      return
    }

    const outgoingBranch = previousBranchRef.current
    if (!outgoingBranch) {
      setSelectedBranchOverride(undefined)
      return
    }

    setSelectedBranchOverride(outgoingBranch)
    const timeout = window.setTimeout(() => {
      previousBranchRef.current = null
      setSelectedBranchOverride(undefined)
    }, WORKSPACE_PANE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [compact, selectedBranch])

  return compact ? selectedBranchOverride : undefined
}
