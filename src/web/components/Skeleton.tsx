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

interface BranchNavigatorSkeletonProps {
  rows?: number
  showBranchActions?: boolean
}

interface RowCountProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  layout?: RepoWorkspaceLayout
  singlePane?: boolean
}

export function BranchNavigatorSkeleton({ rows = 6, showBranchActions = false }: BranchNavigatorSkeletonProps) {
  return (
    <SkeletonList
      rows={rows}
      className="flex flex-1 flex-col gap-1 p-1.5"
      renderRow={(i) => <BranchNavigatorSkeletonRow key={i} showActions={showBranchActions} />}
    />
  )
}

export function StatusListSkeleton({ rows = 6 }: RowCountProps) {
  return <SkeletonList rows={rows} renderRow={(i) => <StatusListSkeletonRow key={i} />} />
}

// RepoWorkspaceSkeleton renders the branch navigator + workspace pane while
// a repo is being hydrated. The per-repo toolbar lives in the Topbar,
// so the workspace skeleton just shows the panes.
export function RepoWorkspaceSkeleton({
  layout = DEFAULT_WORKSPACE_LAYOUT,
  singlePane = false,
}: WorkspaceSkeletonProps) {
  const branchWorkspacePane = (
    <RepoWorkspacePane>
      <BranchWorkspaceSkeleton layout={layout} />
    </RepoWorkspacePane>
  )
  const branchNavigatorPane = (
    <RepoWorkspacePane>
      <BranchNavigatorSkeleton showBranchActions />
    </RepoWorkspacePane>
  )

  if (singlePane) {
    return <section className="flex min-w-0 flex-1 flex-col">{branchNavigatorPane}</section>
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoWorkspace
        layout={layout}
        mode="split"
        branchNavigatorPane={branchNavigatorPane}
        branchWorkspacePane={branchWorkspacePane}
      />
    </section>
  )
}

export function BranchWorkspaceSkeleton({ layout = DEFAULT_WORKSPACE_LAYOUT }: { layout?: RepoWorkspaceLayout }) {
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

function SkeletonList({
  rows,
  className = 'flex-1 divide-y divide-separator',
  renderRow,
}: {
  rows: number
  className?: string
  renderRow: (index: number) => ReactNode
}) {
  return <ul className={className}>{Array.from({ length: rows }).map((_, i) => renderRow(i))}</ul>
}

function BranchNavigatorSkeletonRow({ showActions }: { showActions: boolean }) {
  return (
    <li
      className={cn(
        'grid min-h-9 items-stretch rounded-md bg-muted/35',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-4">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center pr-4">
          <div data-testid="branch-navigator-skeleton-action">
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
