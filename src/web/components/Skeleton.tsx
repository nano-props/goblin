import type { ReactNode } from 'react'
// Skeleton row used as a placeholder while a list loads. Each bar shows a
// shimmer sweep via CSS so the user sees motion (not a frozen list) during
// the IPC round-trip. We render a fixed number of rows — the real list
// usually has dozens, so a half-dozen skeletons is enough to fill the
// visible area without committing to an exact count.

import { cn } from '#/web/lib/cn.ts'
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
  const showBranchActions = layout === 'left-right'
  const showPanelControls = behavior.detailFocusAllowed || behavior.detailCollapseAllowed

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <Toolbar variant="detail">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 gap-1">
            <div className="h-7 px-2.5 flex items-center">
              <Bar w="42px" h="14px" tone="strong" />
            </div>
            <div className="h-7 px-2.5 flex items-center">
              <Bar w="42px" h="14px" tone="strong" />
            </div>
            <div className="h-7 px-2.5 flex items-center">
              <Bar w="42px" h="14px" tone="strong" />
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="min-w-2 flex-1 self-stretch" />
        <div className="flex shrink-0 items-center gap-1">
          {showBranchActions && (
            <div data-testid="branch-detail-skeleton-action">
              <Bar w="72px" h="24px" tone="strong" />
            </div>
          )}
          {showBranchActions && showPanelControls && (
            <div aria-hidden="true" className="mx-1 h-4 border-l border-separator/70" />
          )}
          {behavior.detailFocusAllowed && <Bar w="28px" h="28px" tone="strong" />}
          {behavior.detailCollapseAllowed && <Bar w="28px" h="28px" tone="strong" />}
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
            <Bar w="14px" h="14px" round />
            <Bar w="120px" h="14px" tone="strong" />
            <Bar w="44px" h="16px" />
            <Bar w="96px" h="11px" />
            <div data-testid="repo-toolbar-skeleton-focus-actions">
              <Bar w="72px" h="24px" tone="strong" />
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
        <Bar w={compact ? '28px' : '66px'} h="28px" />
      </div>
      <div data-testid="repo-toolbar-skeleton-create-worktree">
        <Bar w={compact ? '28px' : '118px'} h="28px" />
      </div>
    </div>
  )
}

function ToolbarPagerSkeleton() {
  return (
    <div className="flex items-center gap-1" data-testid="repo-toolbar-skeleton-pager">
      <Bar w="34px" h="11px" />
      <Bar w="24px" h="24px" />
      <Bar w="24px" h="24px" />
    </div>
  )
}

function ToolbarSearchSkeleton({ dataTestId }: { dataTestId?: string }) {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-control shadow-xs"
      data-testid={dataTestId}
    >
      <Bar w="14px" h="14px" round />
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
          <Bar w="14px" h="14px" round />
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

function BranchListSkeletonRow({ index, showActions }: { index: number; showActions: boolean }) {
  const nameWidths = ['30%', '38%', '26%', '34%']
  const badgeWidths = ['46px', '54px', '40px', '48px']
  const metaWidths = ['20%', '16%', '24%', '18%']

  return (
    <li
      className={cn(
        'grid min-h-9 items-stretch',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-4 py-1.5">
        <Bar w="14px" h="14px" round />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Bar w={nameWidths[index % nameWidths.length]} h="14px" tone="strong" />
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <Bar w={badgeWidths[index % badgeWidths.length]} h="16px" />
            <Bar w="18px" h="11px" />
            <Bar w={metaWidths[index % metaWidths.length]} h="11px" />
          </div>
        </div>
      </div>
      {showActions && (
        <div className="flex shrink-0 items-center py-1.5 pr-4">
          <div data-testid="branch-list-skeleton-action">
            <Bar w="58px" h="24px" />
          </div>
        </div>
      )}
    </li>
  )
}

function StatusListSkeletonRow() {
  return (
    <li className="grid grid-cols-[2ch_minmax(0,1fr)] items-center gap-3 px-1.5">
      <Bar w="2ch" h="14px" />
      <Bar w="100%" h="14px" />
    </li>
  )
}

function Bar({
  w,
  h,
  round,
  className,
  tone = 'default',
}: {
  w: string
  h: string
  round?: boolean
  className?: string
  tone?: 'default' | 'strong'
}) {
  return (
    <span
      className={cn(
        'block',
        tone === 'strong' ? 'skeleton-shimmer-strong' : 'skeleton-shimmer',
        round ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{ width: w, height: h }}
    />
  )
}
