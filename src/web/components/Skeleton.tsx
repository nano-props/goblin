// Skeleton row used as a placeholder while a list loads. Pulses via CSS
// keyframe so the user sees motion (not a frozen list) during the IPC
// round-trip. We render a fixed number of rows — the real list usually
// has dozens, so a half-dozen skeletons is enough to fill the visible
// area without committing to an exact count.

import { cn } from '#/web/lib/cn.ts'
import { RepoWorkspace, RepoWorkspacePane, Toolbar } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'

interface Props {
  rows?: number
  /** Layout flavour:
   *  - "branch": two-line row with hash + subject (matches BranchList)
   *  - "log": single-line + tiny meta (matches LogList)
   *  - "status": label chip + path (matches StatusList) */
  variant?: 'branch' | 'log' | 'status'
}

interface WorkspaceSkeletonProps {
  showRepoToolbar?: boolean
  layout?: RepoWorkspaceLayout
  detailCollapsed?: boolean
}

export function ListSkeleton({ rows = 6, variant = 'branch' }: Props) {
  return (
    <ul className="flex-1 divide-y divide-separator">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="px-4 py-2.5 flex items-start gap-2">
          {variant === 'status' ? (
            <>
              <Bar w="32px" h="14px" />
              <Bar w="60px" h="14px" />
              <Bar w="60%" h="14px" />
            </>
          ) : (
            <>
              <Bar w="14px" h="14px" round className="mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Bar w="35%" h="14px" />
                  {variant === 'branch' && <Bar w="60px" h="10px" />}
                </div>
                <Bar w={variant === 'log' ? '70%' : '85%'} h="11px" />
                {variant === 'branch' && <Bar w="40%" h="10px" />}
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function RepoWorkspaceSkeleton({
  showRepoToolbar = false,
  layout = DEFAULT_WORKSPACE_LAYOUT,
  detailCollapsed = false,
}: WorkspaceSkeletonProps) {
  const behavior = repoWorkspaceBehavior(layout, detailCollapsed)

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {showRepoToolbar && (
        <Toolbar variant="repo">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <Bar w="120px" h="14px" tone="strong" />
            <Bar w="35%" h="11px" />
          </div>
          <div className="flex items-center gap-1">
            <Bar w="64px" h="24px" />
            <Bar w="56px" h="24px" />
            <Bar w="116px" h="24px" />
          </div>
        </Toolbar>
      )}
      <RepoWorkspace
        layout={layout}
        mode={behavior.mode}
        branchPane={
          <RepoWorkspacePane>
            <ListSkeleton variant="branch" />
          </RepoWorkspacePane>
        }
        detailPane={
          <RepoWorkspacePane>
            <BranchDetailSkeleton collapsed={behavior.detailCollapsed} />
          </RepoWorkspacePane>
        }
      />
    </section>
  )
}

export function BranchDetailSkeleton({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <Toolbar className="justify-between gap-2 bg-card px-2">
        <div className="flex gap-0.5">
          <div className="h-7 px-2.5 flex items-center">
            <Bar w="42px" h="14px" tone="strong" />
          </div>
          <div className="h-7 px-2.5 flex items-center">
            <Bar w="42px" h="14px" tone="strong" />
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden py-1">
          <Bar w="66px" h="24px" tone="strong" />
          <Bar w="56px" h="24px" tone="strong" />
          <Bar w="58px" h="24px" tone="strong" />
          <Bar w="72px" h="24px" tone="strong" />
        </div>
      </Toolbar>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ListSkeleton rows={8} variant="status" />
        </div>
      )}
    </section>
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
        'block animate-pulse',
        tone === 'strong' ? 'bg-accent' : 'bg-muted',
        round ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{ width: w, height: h }}
    />
  )
}
