import { cn } from '#/web/lib/cn.ts'
import { compositeFocusRing } from '#/web/components/ui/focus.ts'

type ToolbarTabVariant = 'repo' | 'workspace'

export function toolbarTabChromeClassName(options: {
  variant: ToolbarTabVariant
  active: boolean
  dragging?: boolean
  // Expanded workspace tabs use a fixed width so title changes don't shift neighbouring
  // tabs; compact workspace strips show one tab, so that tab can fill the available row.
  compact?: boolean
  hoverable?: boolean
}): string {
  const { variant, active, dragging = false, compact = false, hoverable = true } = options
  // The repo picker and compact workspace strips render only one visible item,
  // so the "active" chrome would be visually misleading. Mute it to match the
  // idle tab chrome from expanded strips.
  const muteActiveChrome = compact
  return cn(
    'group relative select-none items-center transition-colors duration-100',
    compositeFocusRing,
    variant === 'repo'
      ? 'flex h-8 min-w-36 max-w-64 shrink-0 touch-none gap-1.5 rounded-md border px-2 text-xs'
      : compact
        ? 'flex h-7 min-w-0 flex-1 gap-1 rounded-md border px-2.5 text-sm'
        : 'flex h-7 w-36 shrink-0 gap-1 rounded-md border px-2.5 text-sm',
    variant === 'repo'
      ? active && !muteActiveChrome
        ? 'border-input bg-card text-foreground'
        : cn('border-transparent text-foreground', hoverable && 'hover:bg-accent/70')
      : active && !muteActiveChrome
        ? 'border-transparent bg-selected text-selected-foreground'
        : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
    dragging && 'z-10 cursor-grabbing',
    dragging && !active && 'bg-card text-foreground',
  )
}

export function toolbarTabButtonClassName(_variant: ToolbarTabVariant): string | undefined {
  // Reserved for future variant-specific button tweaks. `h-full` lives on
  // the shared base button className in ToolbarClosableTab so the
  // clickable area always fills the container's full height.
  return undefined
}

export function toolbarTabIconClassName(active: boolean, compact = false): string {
  // The repo picker and compact workspace strips show only one visible item;
  // the icon follows the muted chrome.
  const emphasized = active && !compact
  return cn('shrink-0', emphasized ? 'text-foreground' : 'text-muted-foreground')
}
