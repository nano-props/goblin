import type { CSSProperties, ReactNode } from 'react'
// Skeleton placeholders used while a list loads.  We keep the shapes
// coarse — a few large blocks per row — rather than mirroring every
// badge, icon, and label.  This matches the shadcn/ui Skeleton style
// (animate-pulse + bg-muted) and avoids the "fine-grained flicker"
// that comes from dozens of tiny bars pulsing in unison.

import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_ACTION_SLOT_CLASS,
  BRANCH_ROW_CONTENT_CLASS,
  BRANCH_ROW_GRID_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarLeadingSpacer,
} from '#/web/components/workspace-toolbar-chrome.tsx'

interface BranchNavigatorSkeletonProps {
  rows?: number
}

interface RowCountProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  singlePane?: boolean
  singlePaneView?: 'navigator' | 'workspace'
  branchWorkspaceState?: 'empty' | 'content'
}

export function BranchNavigatorSkeleton({ rows = 6 }: BranchNavigatorSkeletonProps) {
  return (
    <SkeletonList
      rows={rows}
      className={BRANCH_ROW_LIST_CLASS}
      renderRow={(i) => <BranchNavigatorSkeletonRow key={i} />}
    />
  )
}

export function StatusListSkeleton({ rows = 6 }: RowCountProps) {
  return (
    <SkeletonList
      rows={rows}
      className="flex-1 py-1.5 tracking-wider"
      style={{ fontFamily: 'var(--font-mono)' }}
      renderRow={(i) => <StatusListSkeletonRow key={i} />}
    />
  )
}

// RepoWorkspaceSkeleton renders the branch navigator + workspace pane while
// a repo is being hydrated. The active repo shell owns the sidebar
// chrome, so the workspace skeleton just shows the panes.
export function RepoWorkspaceSkeleton({
  singlePane = false,
  singlePaneView = 'navigator',
  branchWorkspaceState = 'empty',
}: WorkspaceSkeletonProps) {
  const branchWorkspacePane = (
    <RepoWorkspacePane>
      {branchWorkspaceState === 'content' ? <BranchWorkspaceSkeleton /> : <BranchWorkspaceEmptySkeleton />}
    </RepoWorkspacePane>
  )
  const branchNavigatorPane = (
    <RepoWorkspacePane>
      <BranchNavigatorSkeleton />
    </RepoWorkspacePane>
  )

  if (singlePane) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        {singlePaneView === 'workspace' ? branchWorkspacePane : branchNavigatorPane}
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <RepoWorkspace mode="split" branchNavigatorPane={branchNavigatorPane} branchWorkspacePane={branchWorkspacePane} />
    </section>
  )
}

export function BranchWorkspaceSkeleton({
  toolbarDraggable = true,
  toolbarTrafficLightOffset = false,
}: {
  toolbarDraggable?: boolean
  toolbarTrafficLightOffset?: boolean
}) {
  return (
    <section data-testid="branch-workspace-skeleton" className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceToolbar draggable={toolbarDraggable} trafficLightOffset={toolbarTrafficLightOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={toolbarTrafficLightOffset} />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 gap-1">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
        <div aria-hidden="true" className="min-w-2 flex-1 self-stretch" />
      </WorkspaceToolbar>

      <div className="flex min-h-0 flex-1 flex-col">
        <StatusListSkeleton rows={8} />
      </div>
    </section>
  )
}

export function BranchWorkspaceEmptySkeleton() {
  return (
    <section data-testid="branch-workspace-empty-skeleton" className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <Skeleton className="mx-auto h-4 w-32" />
      </div>
    </section>
  )
}

function SkeletonList({
  rows,
  className = 'flex-1 divide-y divide-separator',
  style,
  renderRow,
}: {
  rows: number
  className?: string
  style?: CSSProperties
  renderRow: (index: number) => ReactNode
}) {
  return (
    <ul className={className} style={style}>
      {Array.from({ length: rows }).map((_, i) => renderRow(i))}
    </ul>
  )
}

function BranchNavigatorSkeletonRow() {
  return (
    <li className={`${BRANCH_ROW_GRID_CLASS} bg-muted/30`}>
      <div className={`${BRANCH_ROW_CONTENT_CLASS} gap-3`}>
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className={BRANCH_ROW_ACTION_SLOT_CLASS}>
        <div className={BRANCH_ROW_ACTION_BOX_CLASS} data-testid="branch-navigator-skeleton-action">
          <Skeleton className="h-6 w-7" />
        </div>
      </div>
    </li>
  )
}

function StatusListSkeletonRow() {
  return (
    <li className="grid min-h-5 grid-cols-[2ch_minmax(0,1fr)] items-center gap-3 px-1.5">
      <Skeleton className="h-3.5 w-[2ch] rounded-sm" />
      <Skeleton className="h-3.5 w-4/5 rounded-sm" />
    </li>
  )
}
