import type { HTMLAttributes, ReactNode } from 'react'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { SplitPane } from '#/renderer/components/SplitPane.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT, workspaceLayoutAxis } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import type { RepoWorkspaceMode } from '#/renderer/lib/workspace-layout.ts'

const LEFT_RIGHT_BRANCH_MIN_SIZE = '14rem'
const LEFT_RIGHT_DETAIL_MIN_SIZE = '22rem'
const TOP_BOTTOM_BRANCH_MIN_SIZE = '10rem'
const TOP_BOTTOM_DETAIL_MIN_SIZE = '9rem'

interface ShellProps {
  children: ReactNode
}

interface RepoWorkspaceProps {
  branchPane: ReactNode
  detailPane: ReactNode
  layout?: RepoWorkspaceLayout
  mode?: RepoWorkspaceMode
  detailSize?: number
  onDetailSizeChange?: (size: number) => void
}

interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  variant?: 'plain' | 'repo' | 'detail'
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
        'flex h-9 shrink-0 items-center border-b border-separator',
        variant === 'repo' && 'gap-3 bg-card px-4',
        variant === 'detail' && 'min-w-0 justify-between gap-2 bg-card px-2',
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
  branchPane,
  detailPane,
  layout = DEFAULT_WORKSPACE_LAYOUT,
  mode = 'split',
  detailSize = DEFAULT_DETAIL_PANE_SIZES[layout],
  onDetailSizeChange,
}: RepoWorkspaceProps) {
  const axis = workspaceLayoutAxis(layout)
  const workspaceMode = axis === 'rows' ? mode : 'split'
  if (workspaceMode === 'focus') {
    return (
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1px_minmax(0,1fr)]">
        {branchPane}
        <WorkspaceSeparator />
        {detailPane}
      </div>
    )
  }
  if (workspaceMode === 'split') {
    return (
      <SplitPane
        orientation={axis === 'columns' ? 'horizontal' : 'vertical'}
        before={branchPane}
        after={detailPane}
        afterSize={detailSize}
        onAfterSizeChange={onDetailSizeChange}
        beforeMinSize={axis === 'columns' ? LEFT_RIGHT_BRANCH_MIN_SIZE : TOP_BOTTOM_BRANCH_MIN_SIZE}
        afterMinSize={axis === 'columns' ? LEFT_RIGHT_DETAIL_MIN_SIZE : TOP_BOTTOM_DETAIL_MIN_SIZE}
        afterMaxSize="90%"
        className="flex-1"
      />
    )
  }
  // Collapsed top/bottom layout keeps only the detail toolbar visible.
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_1px_2.25rem]">
      {branchPane}
      <WorkspaceSeparator />
      {detailPane}
    </div>
  )
}

function WorkspaceSeparator() {
  return <div className="bg-border" aria-hidden />
}

export function RepoWorkspacePane({ children }: PaneProps) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
}

export function ScrollPane({ children }: ShellProps) {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full">
      {children}
    </ScrollArea>
  )
}

export function EmptyState({ icon, title, body, tone = 'neutral' }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div>
        {icon && (
          <div
            className={cn(
              'mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full',
              tone === 'success' ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </div>
        )}
        <div className="text-sm font-medium text-foreground">{title}</div>
        {body && <div className="mt-1 text-xs text-muted-foreground">{body}</div>}
      </div>
    </div>
  )
}
