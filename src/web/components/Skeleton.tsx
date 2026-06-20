import type { ReactNode } from 'react'
// Skeleton placeholders used while a list loads.  We keep the shapes
// coarse — a few large blocks per row — rather than mirroring every
// badge, icon, and label.  This matches the shadcn/ui Skeleton style
// (animate-pulse + bg-muted) and avoids the "fine-grained flicker"
// that comes from dozens of tiny bars pulsing in unison.

import { cn } from '#/web/lib/cn.ts'
import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane, Toolbar } from '#/web/components/Layout.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface BranchListSkeletonProps {
  rows?: number
  showBranchActions?: boolean
}

interface RowCountProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  layout?: RepoWorkspaceLayout
  branchListPaneVisible?: boolean
}

export function BranchListSkeleton({ rows = 6, showBranchActions = false }: BranchListSkeletonProps) {
  return (
    <SkeletonList rows={rows} renderRow={(i) => <BranchListSkeletonRow key={i} showActions={showBranchActions} />} />
  )
}

export function StatusListSkeleton({ rows = 6 }: RowCountProps) {
  return <SkeletonList rows={rows} renderRow={(i) => <StatusListSkeletonRow key={i} />} />
}

// RepoWorkspaceSkeleton renders the branch list + workspace pane while
// a repo is being hydrated. The per-repo toolbar lives in the Topbar,
// so the workspace skeleton just shows the panes.
export function RepoWorkspaceSkeleton({
  layout = DEFAULT_WORKSPACE_LAYOUT,
  branchListPaneVisible = true,
}: WorkspaceSkeletonProps) {
  const behavior = repoWorkspaceBehavior(layout, branchListPaneVisible)
  const workspacePane = (
    <RepoWorkspacePane>
      <BranchDetailSkeleton layout={layout} />
    </RepoWorkspacePane>
  )
  const branchPane = (
    <RepoWorkspacePane>
      <BranchListSkeleton showBranchActions={behavior.branchListActionsVisible} />
    </RepoWorkspacePane>
  )

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoWorkspace layout={layout} mode={behavior.mode} branchPane={branchPane} workspacePane={workspacePane} />
    </section>
  )
}

export function BranchDetailSkeleton({
  layout = DEFAULT_WORKSPACE_LAYOUT,
}: {
  layout?: RepoWorkspaceLayout
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <Toolbar variant="detail">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 gap-1">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
        <div aria-hidden="true" className="min-w-2 flex-1 self-stretch" />
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col">
        <StatusListSkeleton rows={8} />
      </div>
    </section>
  )
}

function SkeletonList({ rows, renderRow }: { rows: number; renderRow: (index: number) => ReactNode }) {
  return (
    <ul className="flex-1 divide-y divide-separator">{Array.from({ length: rows }).map((_, i) => renderRow(i))}</ul>
  )
}

function BranchListSkeletonRow({ showActions }: { showActions: boolean }) {
  return (
    <li className={cn('grid min-h-9 items-stretch', showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1')}>
      <div className="flex min-w-0 items-center gap-3 px-4">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center pr-4">
          <div data-testid="branch-list-skeleton-action">
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      )}
    </li>
  )
}

function StatusListSkeletonRow() {
  return (
    <li className="px-4 py-2.5">
      <Skeleton className="h-4 w-full" />
    </li>
  )
}
