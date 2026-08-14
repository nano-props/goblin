import { cn } from '#/web/lib/cn.ts'
import {
  isPendingWorkspacePaneTabItem,
  isRuntimePlaceholderWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'

// Non-breaking space: keeps the title slot a stable size during the busy/pending
// phase so the icon and close button don't shift when the title fades in.
const TITLE_PLACEHOLDER = ' '

/**
 * Renders a workspace-pane tab title that fades in once the label is known
 * (e.g. once the PTY reports its shell name like "zsh"/"bash"). During the
 * pending/busy phase a blank slot is rendered invisibly so the surrounding
 * layout stays put. Honors the global `prefers-reduced-motion` rule.
 */
export function WorkspacePaneTabTitle({ item }: { item: WorkspacePaneTabItem }) {
  const busy = (isPendingWorkspacePaneTabItem(item) || isRuntimePlaceholderWorkspacePaneTabItem(item)) && item.busy
  const ready = !busy && Boolean(item.label)
  return (
    <span class={cn('truncate transition-opacity duration-150 ease-out', ready ? 'opacity-100' : 'opacity-0')}>
      {ready ? item.label : TITLE_PLACEHOLDER}
    </span>
  )
}
