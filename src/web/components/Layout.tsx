import type { ReactNode } from 'react'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { cn } from '#/web/lib/cn.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceMode } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_MOTION_STYLE, WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { REPO_SIDEBAR_MIN_WIDTH, REPO_WORKSPACE_MIN_WIDTH } from '#/web/components/repo-layout/sidebar-sizing.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

interface ShellProps {
  children: ReactNode
}

interface RepoWorkspaceProps {
  sidebarPane: ReactNode
  repoWorkspacePane: ReactNode
  mode?: RepoWorkspaceMode
  sidebarCollapsed?: boolean
  workspacePaneSize?: number
  onWorkspacePaneSizeChange?: (size: number) => void
}

interface CompactRepoWorkspaceProps {
  activePane: 'navigator' | 'workspace'
  sidebarPane: ReactNode
  repoWorkspacePane: ReactNode
  transitionScopeKey?: unknown
}

interface PaneProps {
  children: ReactNode
}

interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  tone?: 'neutral' | 'success'
}

export function RepoWorkspace({
  sidebarPane,
  repoWorkspacePane,
  mode = 'split',
  sidebarCollapsed = false,
  workspacePaneSize = DEFAULT_WORKSPACE_PANE_SIZE,
  onWorkspacePaneSizeChange,
}: RepoWorkspaceProps) {
  if (mode === 'single-pane') return <div className="flex min-h-0 flex-1">{repoWorkspacePane}</div>

  return (
    <SplitPane
      before={sidebarPane}
      after={repoWorkspacePane}
      afterSize={workspacePaneSize}
      onAfterSizeChange={onWorkspacePaneSizeChange}
      beforeCollapsed={sidebarCollapsed}
      animateBeforeCollapse
      beforeMinSize={REPO_SIDEBAR_MIN_WIDTH}
      beforeContentMinSize={REPO_SIDEBAR_MIN_WIDTH}
      afterMinSize={REPO_WORKSPACE_MIN_WIDTH}
      afterMaxSize={sidebarCollapsed ? undefined : '90%'}
      className="flex-1"
    />
  )
}

export function RepoWorkspacePane({ children }: PaneProps) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
}

export function CompactRepoWorkspace({
  activePane,
  sidebarPane,
  repoWorkspacePane,
  transitionScopeKey,
}: CompactRepoWorkspaceProps) {
  const workspaceActive = activePane === 'workspace'
  const retainedSidebarPane = useRetainedValueDuringExit({
    value: { content: sidebarPane },
    active: !workspaceActive,
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: transitionScopeKey,
  })
  const retainedWorkspacePane = useRetainedValueDuringExit({
    value: { content: repoWorkspacePane },
    active: workspaceActive,
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: transitionScopeKey,
  })

  return (
    <div
      data-compact-workspace=""
      data-active-pane={activePane}
      style={WORKSPACE_PANE_MOTION_STYLE}
      className="goblin-compact-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      <div
        data-compact-workspace-pane="navigator"
        aria-hidden={workspaceActive || undefined}
        inert={workspaceActive || undefined}
        className="goblin-compact-workspace__pane goblin-compact-workspace__pane--navigator absolute inset-0 flex min-h-0 min-w-0 bg-background"
      >
        {workspaceActive ? (retainedSidebarPane?.content ?? sidebarPane) : sidebarPane}
      </div>
      <div
        data-compact-workspace-pane="workspace"
        aria-hidden={!workspaceActive || undefined}
        inert={!workspaceActive || undefined}
        className="goblin-compact-workspace__pane goblin-compact-workspace__pane--workspace absolute inset-0 flex min-h-0 min-w-0 bg-background"
      >
        {workspaceActive ? repoWorkspacePane : (retainedWorkspacePane?.content ?? repoWorkspacePane)}
      </div>
    </div>
  )
}

export function ScrollPane({ children }: ShellProps) {
  return <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
}

export function EmptyState({ icon, title, body, tone = 'neutral' }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div className="space-y-1">
        {icon && (
          <div
            className={cn(
              'mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full',
              tone === 'success' ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </div>
        )}
        <div className="text-sm font-medium text-foreground">{title}</div>
        {body && <div className="text-xs text-muted-foreground">{body}</div>}
      </div>
    </div>
  )
}
