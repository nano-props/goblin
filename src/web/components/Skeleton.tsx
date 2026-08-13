import { defineComponent } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
// Skeleton placeholders used while a list loads.  We keep the shapes
// coarse — a few large blocks per row — rather than mirroring every
// badge, icon, and label.  This matches the shadcn/ui Skeleton style
// (animate-pulse + bg-muted) and avoids the "fine-grained flicker"
// that comes from dozens of tiny bars pulsing in unison.

import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { WorkspaceLayoutPane, WorkspaceSplitLayout } from '#/web/components/Layout.tsx'
import {
  NAVIGATOR_ROW_ACTION_BOX_CLASS,
  NAVIGATOR_ROW_ACTION_SLOT_CLASS,
  NAVIGATOR_ROW_CONTENT_CLASS,
  NAVIGATOR_ROW_GRID_CLASS,
  NAVIGATOR_ROW_LIST_CLASS,
} from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
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

interface GitWorkspaceNavigatorSkeletonProps {
  rows?: number
}

interface WorkspaceSkeletonProps {
  singlePane?: boolean
  singlePaneView?: 'navigator' | 'workspace'
  workspacePaneState?: 'empty' | 'content'
}

export function GitWorkspaceNavigatorSkeleton({ rows = 6 }: GitWorkspaceNavigatorSkeletonProps) {
  return (
    <SkeletonList
      rows={rows}
      class={NAVIGATOR_ROW_LIST_CLASS}
      renderRow={(i) => <GitWorkspaceNavigatorSkeletonRow key={i} />}
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
      <GitWorkspaceNavigatorSkeleton />
    </WorkspaceLayoutPane>
  )

  if (singlePane) {
    return (
      <section class="flex min-w-0 flex-1 flex-col">
        {singlePaneView === 'workspace' ? workspacePane : sidebarPane}
      </section>
    )
  }

  return (
    <section class="flex min-w-0 flex-1 flex-col">
      <WorkspaceSplitLayout mode="split" sidebarPane={sidebarPane} workspacePane={workspacePane} />
    </section>
  )
}

export const WorkspacePaneSkeleton = defineComponent<{ toolbarTrafficLightOffset?: boolean }>({
  name: 'WorkspacePaneSkeleton',
  props: { toolbarTrafficLightOffset: Boolean },
  setup(props) {
    const compact = useIsCompactUi()
    return () => (
      <section
        data-testid="workspace-pane-skeleton"
        aria-busy="true"
        class="flex min-h-0 flex-1 flex-col bg-background"
      >
        <WorkspaceToolbar
          draggable={!compact.value}
          trafficLightOffset={!!props.toolbarTrafficLightOffset}
          aria-hidden="true"
        >
          <WorkspaceToolbarLeadingSpacer reserve={!!props.toolbarTrafficLightOffset} />
          <WorkspaceToolbarContent>
            <WorkspaceToolbarPrimary>
              {compact.value ? (
                <>
                  <Skeleton data-testid="workspace-pane-skeleton-back" class="h-7 w-7 shrink-0" />
                  <Skeleton
                    data-testid="workspace-pane-skeleton-tab"
                    class={WORKSPACE_PANE_TAB_COMPACT_GEOMETRY_CLASS}
                  />
                  <Skeleton data-testid="workspace-pane-skeleton-switcher" class="h-7 w-7 shrink-0" />
                </>
              ) : (
                Array.from({ length: 2 }, (_, index) => (
                  <Skeleton
                    key={index}
                    data-testid="workspace-pane-skeleton-tab"
                    class={WORKSPACE_PANE_TAB_EXPANDED_GEOMETRY_CLASS}
                  />
                ))
              )}
            </WorkspaceToolbarPrimary>
            <WorkspaceToolbarActions aria-hidden="true" />
          </WorkspaceToolbarContent>
        </WorkspaceToolbar>

        <div class="flex min-h-0 flex-1 flex-col" aria-hidden="true">
          <WorkspaceStatusSkeleton rows={8} />
        </div>
      </section>
    )
  },
})

export function EmptyWorkspacePaneSkeleton() {
  return (
    <section data-testid="empty-workspace-pane-skeleton" class="flex min-h-0 flex-1 flex-col bg-background">
      <div class="flex flex-1 items-center justify-center p-6 text-center">
        <Skeleton class="mx-auto h-4 w-32" />
      </div>
    </section>
  )
}

interface SkeletonListProps {
  rows: number
  class?: string
  renderRow: (index: number) => VNodeChild
}

const SkeletonList: FunctionalComponent<SkeletonListProps> = ({
  rows,
  class: classValue = 'flex-1 divide-y divide-separator',
  renderRow,
}) => {
  return (
    <ul class={classValue} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => renderRow(i))}
    </ul>
  )
}
SkeletonList.props = ['rows', 'class', 'renderRow']
SkeletonList.inheritAttrs = false

function GitWorkspaceNavigatorSkeletonRow() {
  return (
    <li class={`${NAVIGATOR_ROW_GRID_CLASS} bg-muted/30`}>
      <div class={`${NAVIGATOR_ROW_CONTENT_CLASS} gap-3`}>
        <Skeleton class="h-4 w-4 rounded-full" />
        <Skeleton class="h-4 w-3/5" />
      </div>
      <div class={NAVIGATOR_ROW_ACTION_SLOT_CLASS}>
        <div class={NAVIGATOR_ROW_ACTION_BOX_CLASS} data-testid="git-workspace-navigator-skeleton-action">
          <Skeleton class="h-6 w-7" />
        </div>
      </div>
    </li>
  )
}

function WorkspaceStatusSkeleton({ rows }: { rows: number }) {
  return (
    <div class={STATUS_ROWS_CLASS} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <WorkspaceStatusSkeletonRow key={index} />
      ))}
    </div>
  )
}

function WorkspaceStatusSkeletonRow() {
  return (
    <div data-testid="workspace-status-skeleton-row" class={STATUS_ROW_LAYOUT_CLASS}>
      <div class="flex size-5 items-center justify-center">
        <Skeleton class="size-3.5 rounded-sm" />
      </div>
      <Skeleton class="h-3 w-14 rounded-sm" />
      <Skeleton class="h-5 w-2/5 rounded-sm" />
    </div>
  )
}
