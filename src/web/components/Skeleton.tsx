import type { ReactNode } from 'react'
// Skeleton placeholders used while a list loads.  We keep the shapes
// coarse — a few large blocks per row — rather than mirroring every
// badge, icon, and label.  This matches the shadcn/ui Skeleton style
// (animate-pulse + bg-muted) and avoids the "fine-grained flicker"
// that comes from dozens of tiny bars pulsing in unison.

import { cn } from '#/web/lib/cn.ts'
import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane, Toolbar } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'

interface BranchListSkeletonProps {
  rows?: number
  showBranchActions?: boolean
}

interface RowCountProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  showRepoToolbar?: boolean
  layout?: RepoWorkspaceLayout
  detailCollapsed?: boolean
  detailFocusMode?: boolean
  compact?: boolean
}

export function BranchListSkeleton({ rows = 6, showBranchActions = false }: BranchListSkeletonProps) {
  return (
    <SkeletonList rows={rows} renderRow={(i) => <BranchListSkeletonRow key={i} showActions={showBranchActions} />} />
  )
}

export function StatusListSkeleton({ rows = 6 }: RowCountProps) {
  return <SkeletonList rows={rows} renderRow={(i) => <StatusListSkeletonRow key={i} />} />
}

export function RepoWorkspaceSkeleton({
  showRepoToolbar = false,
  layout = DEFAULT_WORKSPACE_LAYOUT,
  detailCollapsed = false,
  detailFocusMode = false,
  compact = false,
}: WorkspaceSkeletonProps) {
  const behavior = repoWorkspaceBehavior(layout, detailCollapsed, detailFocusMode)
  const detailPane = (
    <RepoWorkspacePane>
      <BranchDetailSkeleton
        layout={layout}
        collapsed={behavior.detailCollapsed}
        detailFocusMode={behavior.detailFocusMode}
      />
    </RepoWorkspacePane>
  )
  const workspaceMode = behavior.mode === 'collapsed' ? 'collapsed' : 'split'
  const branchPane = (
    <RepoWorkspacePane>
      {showRepoToolbar && <RepoToolbarSkeleton compact={compact} />}
      <BranchListSkeleton showBranchActions={behavior.branchListActionsVisible} />
    </RepoWorkspacePane>
  )
  const workspaceBody =
    behavior.mode === 'focus' ? (
      detailPane
    ) : (
      <RepoWorkspace layout={layout} mode={workspaceMode} branchPane={branchPane} detailPane={detailPane} />
    )

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {showRepoToolbar && behavior.mode === 'focus' && <RepoToolbarSkeleton focusMode compact={compact} />}
      {workspaceBody}
    </section>
  )
}

export function BranchDetailSkeleton({
  layout = DEFAULT_WORKSPACE_LAYOUT,
  collapsed = false,
  detailFocusMode = false,
}: {
  layout?: RepoWorkspaceLayout
  collapsed?: boolean
  detailFocusMode?: boolean
}) {
  const behavior = repoWorkspaceBehavior(layout, collapsed, detailFocusMode)

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
        <div className="flex shrink-0 items-center gap-1">
          {behavior.detailFocusAllowed && <Skeleton className="h-7 w-7" />}
          {behavior.detailCollapseAllowed && <Skeleton className="h-7 w-7" />}
        </div>
      </Toolbar>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col">
          <StatusListSkeleton rows={8} />
        </div>
      )}
    </section>
  )
}

function RepoToolbarSkeleton({ focusMode = false, compact = false }: { focusMode?: boolean; compact?: boolean }) {
  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {focusMode ? (
          <>
            <ToolbarPagerSkeleton />
            <div aria-hidden="true" className="mx-1 h-4 border-l border-separator/70" />
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <div data-testid="repo-toolbar-skeleton-focus-actions">
              <Skeleton className="h-7 w-7" />
            </div>
          </>
        ) : compact ? (
          <ToolbarPagerSkeleton />
        ) : (
          <>
            <ToolbarSegmentedControlSkeleton items={3} dataTestId="repo-toolbar-skeleton-branch-view" />
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RepoToolbarActionsSkeleton compact={compact} />
        {!compact && <ToolbarSegmentedControlSkeleton items={2} dataTestId="repo-toolbar-skeleton-layout-control" />}
      </div>
    </Toolbar>
  )
}

function RepoToolbarActionsSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div data-testid="repo-toolbar-skeleton-activity">
        <Skeleton className={cn('h-7', compact ? 'w-7' : 'w-16')} />
      </div>
      <div data-testid="repo-toolbar-skeleton-create-worktree">
        <Skeleton className={cn('h-7', compact ? 'w-7' : 'w-24')} />
      </div>
    </div>
  )
}

function ToolbarPagerSkeleton() {
  return (
    <div className="flex items-center gap-1" data-testid="repo-toolbar-skeleton-pager">
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-7 w-7" />
      <Skeleton className="h-7 w-7" />
    </div>
  )
}

function ToolbarSegmentedControlSkeleton({ items, dataTestId }: { items: number; dataTestId?: string }) {
  return (
    <div className="flex shrink-0 rounded-md border border-input bg-control shadow-xs" data-testid={dataTestId}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex h-7 w-7 items-center justify-center border-r border-input last:border-r-0">
          <Skeleton className="h-4 w-4 rounded-full" />
        </div>
      ))}
    </div>
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
