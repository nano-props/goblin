import type { CSSProperties } from 'react'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { cn } from '#/web/lib/cn.ts'

export const WORKSPACE_TOOLBAR_STYLE = { height: WINDOW_TOPBAR_HEIGHT_PX } satisfies CSSProperties

interface WorkspaceToolbarChromeOptions {
  draggable?: boolean
  trafficLightOffset?: boolean
}

export function workspaceToolbarClassName({
  draggable = true,
  trafficLightOffset = false,
}: WorkspaceToolbarChromeOptions = {}) {
  return cn(
    'goblin-workspace-toolbar',
    draggable ? (trafficLightOffset ? 'topbar' : 'app-drag-region px-2') : 'px-2',
    'border-border/60 bg-card',
  )
}

export function WorkspaceToolbarLeadingSpacer({ reserve }: { reserve: boolean }) {
  return (
    <div
      data-testid="workspace-toolbar-leading-spacer"
      className={cn(
        'goblin-workspace-toolbar__leading-spacer h-full shrink-0',
        reserve && 'goblin-workspace-toolbar__leading-spacer--reserved',
      )}
      aria-hidden
    />
  )
}

export function WorkspaceChrome({
  draggable = true,
  trafficLightOffset = false,
}: WorkspaceToolbarChromeOptions) {
  return (
    <Toolbar
      variant="workspace"
      className={workspaceToolbarClassName({ draggable, trafficLightOffset })}
      style={WORKSPACE_TOOLBAR_STYLE}
    >
      <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
      <div className="min-w-0 flex-1" />
    </Toolbar>
  )
}
