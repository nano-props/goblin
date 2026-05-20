import type { ReactNode } from 'react'
import { cn } from '#/renderer/lib/cn.ts'

interface ShellProps {
  children: ReactNode
}

interface ToolbarProps {
  children: ReactNode
  className?: string
  variant?: 'plain' | 'repo' | 'detail'
}

interface PaneProps {
  children: ReactNode
  border?: boolean
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

export function Toolbar({ children, className, variant = 'plain' }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center border-b border-border',
        variant === 'repo' && 'gap-3 bg-card px-4',
        variant === 'detail' && 'min-w-0 justify-between gap-2 bg-muted px-2',
        className,
      )}
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

export function RepoWorkspace({ children }: ShellProps) {
  return <div className="grid min-h-0 flex-1 grid-rows-2">{children}</div>
}

export function RepoWorkspacePane({ children, border = false }: PaneProps) {
  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', border && 'border-b border-border')}>{children}</div>
  )
}

export function ScrollPane({ children }: ShellProps) {
  return <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>
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
