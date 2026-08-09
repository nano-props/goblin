import { defineComponent } from 'vue'
import type { FunctionalComponent, PropType, VNodeChild } from 'vue'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { cn } from '#/web/lib/cn.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { WorkspaceLayoutMode } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_MOTION_STYLE, WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  WORKSPACE_PANE_MIN_WIDTH,
} from '#/web/components/workspace-layout/sidebar-sizing.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

interface WorkspaceSplitLayoutProps {
  sidebarPane: VNodeChild
  workspacePane: VNodeChild
  mode?: WorkspaceLayoutMode
  sidebarCollapsed?: boolean
  workspacePaneSize?: number
  onWorkspacePaneSizeChange?: (size: number) => void
}

export const WorkspaceSplitLayout: FunctionalComponent<WorkspaceSplitLayoutProps> = (props) => {
  if (props.mode === 'single-pane') return <div class="flex min-h-0 flex-1">{props.workspacePane}</div>
  return (
    <SplitPane
      before={props.sidebarPane}
      after={props.workspacePane}
      afterSize={props.workspacePaneSize ?? DEFAULT_WORKSPACE_PANE_SIZE}
      onAfterSizeChange={props.onWorkspacePaneSizeChange}
      beforeCollapsed={props.sidebarCollapsed ?? false}
      animateBeforeCollapse
      beforeMinSize={WORKSPACE_SIDEBAR_MIN_WIDTH}
      beforeContentMinSize={WORKSPACE_SIDEBAR_MIN_WIDTH}
      afterMinSize={WORKSPACE_PANE_MIN_WIDTH}
      afterMaxSize={props.sidebarCollapsed ? undefined : '90%'}
      class="flex-1"
    />
  )
}

WorkspaceSplitLayout.props = [
  'sidebarPane',
  'workspacePane',
  'mode',
  'sidebarCollapsed',
  'workspacePaneSize',
  'onWorkspacePaneSizeChange',
]

export const WorkspaceLayoutPane: FunctionalComponent = (_props, { slots }) => (
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{slots.default?.()}</div>
)

export const CompactWorkspaceLayout = defineComponent<{
  activePane: 'navigator' | 'workspace'
  sidebarPane: VNodeChild
  workspacePane: VNodeChild
  transitionScopeKey?: unknown
}>({
  name: 'CompactWorkspaceLayout',
  props: {
    activePane: { type: String as PropType<'navigator' | 'workspace'>, required: true },
    sidebarPane: { type: null, required: true },
    workspacePane: { type: null, required: true },
    transitionScopeKey: null,
  },

  setup(props) {
    const workspaceActive = () => props.activePane === 'workspace'
    const retainedSidebarPane = useRetainedValueDuringExit({
      value: () => ({ content: props.sidebarPane }),
      active: () => !workspaceActive(),
      retainMs: WORKSPACE_PANE_TRANSITION_MS,
      resetKey: () => props.transitionScopeKey,
    })
    const retainedWorkspacePane = useRetainedValueDuringExit({
      value: () => ({ content: props.workspacePane }),
      active: workspaceActive,
      retainMs: WORKSPACE_PANE_TRANSITION_MS,
      resetKey: () => props.transitionScopeKey,
    })

    return () => {
      const active = workspaceActive()
      return (
        <div
          data-compact-workspace=""
          data-active-pane={props.activePane}
          style={WORKSPACE_PANE_MOTION_STYLE}
          class="goblin-compact-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
        >
          <div
            data-compact-workspace-pane="navigator"
            aria-hidden={active || undefined}
            inert={active || undefined}
            class="goblin-compact-workspace__pane goblin-compact-workspace__pane--navigator absolute inset-0 flex min-h-0 min-w-0 bg-background"
          >
            {active ? (retainedSidebarPane.value?.content ?? props.sidebarPane) : props.sidebarPane}
          </div>
          <div
            data-compact-workspace-pane="workspace"
            aria-hidden={!active || undefined}
            inert={!active || undefined}
            class="goblin-compact-workspace__pane goblin-compact-workspace__pane--workspace absolute inset-0 flex min-h-0 min-w-0 bg-background"
          >
            {active ? props.workspacePane : (retainedWorkspacePane.value?.content ?? props.workspacePane)}
          </div>
        </div>
      )
    }
  },
})

export const ScrollPane: FunctionalComponent = (_props, { slots }) => (
  <ScrollArea class="min-h-0 flex-1">{slots.default?.()}</ScrollArea>
)

interface EmptyStateProps {
  icon?: VNodeChild
  title: VNodeChild
  body?: VNodeChild
  tone?: 'neutral' | 'success'
}

export const EmptyState: FunctionalComponent<EmptyStateProps> = (props) => (
  <div class="flex flex-1 items-center justify-center p-6 text-center">
    <div class="space-y-1">
      {props.icon ? (
        <div
          class={cn(
            'mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full',
            props.tone === 'success' ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {props.icon}
        </div>
      ) : null}
      <div class="text-sm font-medium text-foreground">{props.title}</div>
      {props.body ? <div class="text-xs text-muted-foreground">{props.body}</div> : null}
    </div>
  </div>
)

EmptyState.props = ['icon', 'title', 'body', 'tone']
