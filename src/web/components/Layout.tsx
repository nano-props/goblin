import type { HTMLAttributes, ReactNode } from 'react'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { cn } from '#/web/lib/cn.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceMode } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_MOTION_STYLE } from '#/web/components/workspace-motion.ts'
const LEFT_RIGHT_BRANCH_MIN_SIZE = '14rem'
const LEFT_RIGHT_WORKSPACE_MIN_SIZE = '22rem'

interface ShellProps {
  children: ReactNode
}

interface RepoWorkspaceProps {
  branchNavigatorPane: ReactNode
  branchWorkspacePane: ReactNode
  mode?: RepoWorkspaceMode
  branchNavigatorCollapsed?: boolean
  workspacePaneSize?: number
  onWorkspacePaneSizeChange?: (size: number) => void
}

interface CompactRepoWorkspaceProps {
  activePane: 'navigator' | 'workspace'
  branchNavigatorPane: ReactNode
  branchWorkspacePane: ReactNode
}

interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  variant?: 'plain' | 'repo' | 'workspace'
}

interface PaneProps {
  children: ReactNode
}

interface ToolbarTitleProps {
  title: ReactNode
  description?: ReactNode
  after?: ReactNode
}

interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  tone?: 'neutral' | 'success'
}

export function Toolbar({ children, className, variant = 'plain', ...props }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center border-b border-separator/70',
        variant === 'repo' && 'gap-3 bg-card px-4',
        variant === 'workspace' && 'min-w-0 justify-between gap-2 bg-card px-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function ToolbarTitle({ title, description, after }: ToolbarTitleProps) {
  return (
    <div className="min-w-0 flex-1 flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <div className="shrink-0 truncate text-sm font-semibold text-foreground">{title}</div>
        {description && <div className="min-w-0 truncate text-xs text-muted-foreground">{description}</div>}
      </div>
      {after}
    </div>
  )
}

export function RepoWorkspace({
  branchNavigatorPane,
  branchWorkspacePane,
  mode = 'split',
  branchNavigatorCollapsed = false,
  workspacePaneSize = DEFAULT_WORKSPACE_PANE_SIZE,
  onWorkspacePaneSizeChange,
}: RepoWorkspaceProps) {
  if (mode === 'single-pane') return <div className="flex min-h-0 flex-1">{branchWorkspacePane}</div>

  return (
    <SplitPane
      before={branchNavigatorPane}
      after={branchWorkspacePane}
      afterSize={workspacePaneSize}
      onAfterSizeChange={onWorkspacePaneSizeChange}
      beforeCollapsed={branchNavigatorCollapsed}
      animateBeforeCollapse
      beforeMinSize={LEFT_RIGHT_BRANCH_MIN_SIZE}
      beforeContentMinSize={LEFT_RIGHT_BRANCH_MIN_SIZE}
      afterMinSize={LEFT_RIGHT_WORKSPACE_MIN_SIZE}
      afterMaxSize={branchNavigatorCollapsed ? undefined : '90%'}
      className="flex-1"
    />
  )
}

export function RepoWorkspacePane({ children }: PaneProps) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
}

export function CompactRepoWorkspace({
  activePane,
  branchNavigatorPane,
  branchWorkspacePane,
}: CompactRepoWorkspaceProps) {
  const workspaceActive = activePane === 'workspace'

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
        {branchNavigatorPane}
      </div>
      <div
        data-compact-workspace-pane="workspace"
        aria-hidden={!workspaceActive || undefined}
        inert={!workspaceActive || undefined}
        className="goblin-compact-workspace__pane goblin-compact-workspace__pane--workspace absolute inset-0 flex min-h-0 min-w-0 bg-background"
      >
        {branchWorkspacePane}
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
