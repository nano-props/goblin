import { cn } from '#/web/lib/cn.ts'
import { compositeFocusRing } from '#/web/components/ui/focus.ts'

export const WORKSPACE_PANE_TAB_EXPANDED_GEOMETRY_CLASS = 'h-7 w-36 shrink-0 rounded-md'
export const WORKSPACE_PANE_TAB_COMPACT_GEOMETRY_CLASS = 'h-7 min-w-0 flex-1 rounded-md'

export function toolbarTabChromeClassName(options: {
  active: boolean
  dragging?: boolean
  // Expanded workspace tabs use a fixed width so title changes don't shift neighbouring
  // tabs; compact workspace strips show one tab, so that tab can fill the available row.
  compact?: boolean
}): string {
  const { active, dragging = false, compact = false } = options
  return cn(
    'group relative flex select-none items-center gap-1 border px-2.5 text-sm transition-colors duration-100',
    compositeFocusRing,
    compact ? WORKSPACE_PANE_TAB_COMPACT_GEOMETRY_CLASS : WORKSPACE_PANE_TAB_EXPANDED_GEOMETRY_CLASS,
    active && !compact
      ? 'border-transparent bg-selected text-selected-foreground'
      : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
    dragging && 'z-10 cursor-grabbing',
    dragging && !active && 'bg-card text-foreground',
  )
}

export function toolbarTabIconClassName(active: boolean, compact = false): string {
  const emphasized = active && !compact
  return cn('shrink-0', emphasized ? 'text-foreground' : 'text-muted-foreground')
}
