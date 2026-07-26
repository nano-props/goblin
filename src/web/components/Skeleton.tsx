import type { ReactNode } from 'react'
// Skeleton placeholders used while a list loads.  We keep the shapes
// coarse — a few large blocks per row — rather than mirroring every
// badge, icon, and label.  This matches the shadcn/ui Skeleton style
// (animate-pulse + bg-muted) and avoids the "fine-grained flicker"
// that comes from dozens of tiny bars pulsing in unison.

import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { WorkspaceLayoutPane, WorkspaceSplitLayout } from '#/web/components/Layout.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_ACTION_SLOT_CLASS,
  BRANCH_ROW_CONTENT_CLASS,
  BRANCH_ROW_GRID_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import {
  WORKSPACE_PANE_TAB_COMPACT_GEOMETRY_CLASS,
  WORKSPACE_PANE_TAB_EXPANDED_GEOMETRY_CLASS,
} from '#/web/components/tab-strip/tab-variants.ts'
import { STATUS_ROWS_CLASS, STATUS_ROW_LAYOUT_CLASS } from '#/web/components/workspace-pane/status-ui.tsx'

interface BranchNavigatorSkeletonProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  singlePane?: boolean
  singlePaneView?: 'navigator' | 'workspace'
  workspacePaneState?: 'empty' | 'content'
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

// WorkspaceLayoutSkeleton renders the sidebar + workspace pane while
// a workspace is being hydrated. The current workspace shell owns the sidebar
// chrome, so the workspace skeleton just shows the panes.
export function WorkspaceLayoutSkeleton({
  singlePane = false,
  singlePaneView = 'navigator',
  workspacePaneState = 'empty',
}: WorkspaceSkeletonProps) {
  const workspacePane = (
    <WorkspaceLayoutPane>
      {workspacePaneState === 'content' ? <WorkspacePaneSkeleton /> : <EmptyWorkspacePaneSkeleton />}
    </WorkspaceLayoutPane>
  )
  const sidebarPane = (
    <WorkspaceLayoutPane>
      <BranchNavigatorSkeleton />
    </WorkspaceLayoutPane>
  )

  if (singlePane) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        {singlePaneView === 'workspace' ? workspacePane : sidebarPane}
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <WorkspaceSplitLayout mode="split" sidebarPane={sidebarPane} workspacePane={workspacePane} />
    </section>
  )
}

export function WorkspacePaneSkeleton({ toolbarTrafficLightOffset = false }: { toolbarTrafficLightOffset?: boolean }) {
  const compact = useIsCompactUi()
  return (
    <section
      data-testid="workspace-pane-skeleton"
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <WorkspaceToolbar draggable={!compact} trafficLightOffset={toolbarTrafficLightOffset} aria-hidden="true">
        <WorkspaceToolbarLeadingSpacer reserve={toolbarTrafficLightOffset} />
        <WorkspaceToolbarContent>
          <WorkspaceToolbarPrimary>
            {compact ? (
              <>
                <Skeleton data-testid="workspace-pane-skeleton-back" className="h-7 w-7 shrink-0" />
                <Skeleton
                  data-testid="workspace-pane-skeleton-tab"
                  className={WORKSPACE_PANE_TAB_COMPACT_GEOMETRY_CLASS}
                />
                <Skeleton data-testid="workspace-pane-skeleton-switcher" className="h-7 w-7 shrink-0" />
              </>
            ) : (
              Array.from({ length: 3 }, (_, index) => (
                <Skeleton
                  key={index}
                  data-testid="workspace-pane-skeleton-tab"
                  className={WORKSPACE_PANE_TAB_EXPANDED_GEOMETRY_CLASS}
                />
              ))
            )}
          </WorkspaceToolbarPrimary>
          <WorkspaceToolbarActions aria-hidden="true" />
        </WorkspaceToolbarContent>
      </WorkspaceToolbar>

      <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
        <WorkspaceStatusSkeleton rows={8} />
      </div>
    </section>
  )
}

export function EmptyWorkspacePaneSkeleton() {
  return (
    <section data-testid="empty-workspace-pane-skeleton" className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <Skeleton className="mx-auto h-4 w-32" />
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
  return (
    <ul className={className} aria-hidden="true">
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

function WorkspaceStatusSkeleton({ rows }: { rows: number }) {
  return (
    <div className={STATUS_ROWS_CLASS} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <WorkspaceStatusSkeletonRow key={index} />
      ))}
    </div>
  )
}

function WorkspaceStatusSkeletonRow() {
  return (
    <div data-testid="workspace-status-skeleton-row" className={STATUS_ROW_LAYOUT_CLASS}>
      <div className="flex size-5 items-center justify-center">
        <Skeleton className="size-3.5 rounded-sm" />
      </div>
      <Skeleton className="h-3 w-14 rounded-sm" />
      <Skeleton className="h-5 w-2/5 rounded-sm" />
    </div>
  )
}
