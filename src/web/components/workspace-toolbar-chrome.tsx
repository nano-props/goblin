import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { WINDOW_CHROME_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { cn } from '#/web/lib/cn.ts'
import { WindowChromeDragRegion, WindowChromeNoDragRegion } from '#/web/components/window-chrome-region.tsx'

const WORKSPACE_TOOLBAR_STYLE = { height: WINDOW_CHROME_HEIGHT_PX } satisfies CSSProperties
const WORKSPACE_TOOLBAR_BASE_CLASS =
  'goblin-workspace-toolbar flex min-w-0 shrink-0 items-center justify-between gap-0 border-b border-border/60 bg-card px-1.5'

interface WorkspaceToolbarChromeOptions {
  draggable?: boolean
  trafficLightOffset?: boolean
}

interface WorkspaceToolbarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'draggable'>, WorkspaceToolbarChromeOptions {
  children: ReactNode
}

function workspaceToolbarChromeClassName({ draggable = true }: Pick<WorkspaceToolbarChromeOptions, 'draggable'> = {}) {
  return cn(WORKSPACE_TOOLBAR_BASE_CLASS, !draggable && 'px-2')
}

export function WorkspaceToolbar({
  children,
  className,
  draggable = true,
  trafficLightOffset = false,
  style,
  ...props
}: WorkspaceToolbarProps) {
  const toolbarProps = {
    className: cn(
      workspaceToolbarChromeClassName({ draggable }),
      trafficLightOffset && 'goblin-workspace-toolbar--traffic-offset',
      className,
    ),
    style: { ...WORKSPACE_TOOLBAR_STYLE, ...style },
    ...props,
  }

  if (!draggable) {
    return <div {...toolbarProps}>{children}</div>
  }

  return (
    <WindowChromeDragRegion reserveWindowControls={false} {...toolbarProps}>
      {children}
    </WindowChromeDragRegion>
  )
}

export function WorkspaceToolbarLeadingSpacer({
  reserve,
  noDrag = reserve,
}: {
  reserve: boolean
  noDrag?: boolean
}) {
  return (
    <div
      data-testid="workspace-toolbar-leading-spacer"
      className={cn(
        'goblin-workspace-toolbar__leading-spacer h-full shrink-0',
        reserve && 'goblin-workspace-toolbar__leading-spacer--reserved',
        noDrag && 'relative',
      )}
      aria-hidden
    >
      {noDrag ? (
        <WindowChromeNoDragRegion
          data-testid="workspace-toolbar-leading-no-drag"
          className="absolute left-0 top-1/2 size-8 -translate-y-1/2"
        />
      ) : null}
    </div>
  )
}

export function WorkspaceChrome({ draggable = true, trafficLightOffset = false }: WorkspaceToolbarChromeOptions) {
  return (
    <WorkspaceToolbar draggable={draggable} trafficLightOffset={trafficLightOffset}>
      <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
      <div className="min-w-0 flex-1" />
    </WorkspaceToolbar>
  )
}
