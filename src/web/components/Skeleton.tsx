import type { ReactNode } from 'react'
// Skeleton row used as a placeholder while a list loads. Each bar shows a
// soft pulse via Tailwind animate-pulse so the user sees motion (not a
// frozen list) during the IPC round-trip. We render a fixed number of rows
// — the real list usually has dozens, so a half-dozen skeletons is enough
// to fill the visible area without committing to an exact count.

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
    <SkeletonList
      rows={rows}
      renderRow={(i) => <BranchListSkeletonRow key={i} index={i} showActions={showBranchActions} />}
    />
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
  const workspaceBody =
    behavior.mode === 'focus' ? (
      detailPane
    ) : (
      <RepoWorkspace
        layout={layout}
        mode={workspaceMode}
        branchPane={
          <RepoWorkspacePane>
            <BranchListSkeleton showBranchActions={behavior.branchListActionsVisible} />
          </RepoWorkspacePane>
        }
        detailPane={detailPane}
      />
    )

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {showRepoToolbar && <RepoToolbarSkeleton focusMode={behavior.mode === 'focus'} compact={compact} />}
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
            <div className="flex h-7 items-center px-2.5">
              <Skeleton className="h-3.5 w-[42px]" />
            </div>
            <div className="flex h-7 items-center px-2.5">
              <Skeleton className="h-3.5 w-[42px]" />
            </div>
            <div className="flex h-7 items-center px-2.5">
              <Skeleton className="h-3.5 w-[42px]" />
            </div>
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
            <Skeleton className="h-3.5 w-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-[120px]" />
            <Skeleton className="h-4 w-11" />
            <Skeleton className="h-[11px] w-24" />
            <div data-testid="repo-toolbar-skeleton-focus-actions">
              <Skeleton className="h-6 w-6" />
            </div>
          </>
        ) : compact ? (
          <ToolbarPagerSkeleton />
        ) : (
          <>
            <ToolbarSegmentedControlSkeleton items={3} dataTestId="repo-toolbar-skeleton-branch-view" />
            <ToolbarSearchSkeleton dataTestId="repo-toolbar-skeleton-branch-search" />
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
        <Skeleton className={cn('h-7', compact ? 'w-7' : 'w-[66px]')} />
      </div>
      <div data-testid="repo-toolbar-skeleton-create-worktree">
        <Skeleton className={cn('h-7', compact ? 'w-7' : 'w-[118px]')} />
      </div>
    </div>
  )
}

function ToolbarPagerSkeleton() {
  return (
    <div className="flex items-center gap-1" data-testid="repo-toolbar-skeleton-pager">
      <Skeleton className="h-[11px] w-[34px]" />
      <Skeleton className="h-6 w-6" />
      <Skeleton className="h-6 w-6" />
    </div>
  )
}

function ToolbarSearchSkeleton({ dataTestId }: { dataTestId?: string }) {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-control shadow-xs"
      data-testid={dataTestId}
    >
      <Skeleton className="h-3.5 w-3.5 rounded-full" />
    </div>
  )
}

function ToolbarSegmentedControlSkeleton({
  items,
  dataTestId,
}: {
  items: number
  dataTestId?: string
}) {
  return (
    <div className="flex shrink-0 rounded-md border border-input bg-control shadow-xs" data-testid={dataTestId}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex h-7 w-7 items-center justify-center border-r border-input last:border-r-0">
          <Skeleton className="h-3.5 w-3.5 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function SkeletonList({
  rows,
  renderRow,
}: {
  rows: number
  renderRow: (index: number) => ReactNode
}) {
  return <ul className="flex-1 divide-y divide-separator">{Array.from({ length: rows }).map((_, i) => renderRow(i))}</ul>
}

const nameWidthClasses = ['w-[30%]', 'w-[38%]', 'w-[26%]', 'w-[34%]']
const badgeWidthClasses = ['w-[46px]', 'w-[54px]', 'w-[40px]', 'w-[48px]']
const metaWidthClasses = ['w-[20%]', 'w-[16%]', 'w-[24%]', 'w-[18%]']

function BranchListSkeletonRow({ index, showActions }: { index: number; showActions: boolean }) {
  return (
    <li
      className={cn(
        'grid min-h-9 items-stretch',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-4 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded-full" />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Skeleton className={cn('h-3.5', nameWidthClasses[index % nameWidthClasses.length])} />
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <Skeleton className={cn('h-4', badgeWidthClasses[index % badgeWidthClasses.length])} />
            <Skeleton className="h-[11px] w-[18px]" />
            <Skeleton className={cn('h-[11px]', metaWidthClasses[index % metaWidthClasses.length])} />
          </div>
        </div>
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center py-1.5 pr-4">
          <div data-testid="branch-list-skeleton-action">
            <Skeleton className="h-6 w-[58px]" />
          </div>
        </div>
      )}
    </li>
  )
}

function StatusListSkeletonRow() {
  return (
    <li className="grid grid-cols-[2ch_minmax(0,1fr)] items-center gap-3 px-1.5">
      <Skeleton className="h-3.5 w-[2ch]" />
      <Skeleton className="h-3.5 w-full" />
    </li>
  )
}
