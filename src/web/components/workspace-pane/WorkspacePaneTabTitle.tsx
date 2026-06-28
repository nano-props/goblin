import { cn } from '#/web/lib/cn.ts'
import { isPendingWorkspacePaneTabItem, type WorkspacePaneTabItem } from './WorkspacePaneTabStrip.tsx'

// Non-breaking space: keeps the title slot a stable size during the busy/pending
// phase so the icon and close button don't shift when the title fades in.
const TITLE_PLACEHOLDER = ' '

/**
 * Renders a workspace-pane tab title that fades in once the label is known
 * (e.g. once the PTY reports its shell name like "zsh"/"bash"). During the
 * pending/busy phase a non-breaking space is rendered invisibly so the
 * surrounding layout — icon on the left, close button on the right — stays
 * put. Honors the project's global `prefers-reduced-motion` rule.
 */
export function WorkspacePaneTabTitle({ item }: { item: WorkspacePaneTabItem }) {
  const busy = isPendingWorkspacePaneTabItem(item) && item.busy
  const ready = !busy && Boolean(item.label)
  return (
    <span
      className={cn(
        'truncate transition-opacity duration-150 ease-out',
        ready ? 'opacity-100' : 'opacity-0',
      )}
    >
      {ready ? item.label : TITLE_PLACEHOLDER}
    </span>
  )
}
