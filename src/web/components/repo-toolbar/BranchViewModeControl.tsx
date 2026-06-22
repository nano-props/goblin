// Single-button worktree filter for the topbar. The previous
// SegmentedControl (all / worktrees) was hard to discover and the
// "blue pill" reading of the selected thumb (low-opacity accent
// tint) only ever landed muddy against the toolbar's gray
// surroundings. This control is now a single toggle styled the
// same as the rest of the topbar icon toggles
// (variant="ghost" + size="icon-lg" + bg-accent on press) so the
// topbar's icon toggles share one visual language: a flat ghost
// button that paints a subtle accent fill when active. The
// size="icon-lg" matches the rest of the topbar buttons so the
// four controls (Refresh / Filter / CreateWorktree / Settings)
// read as one row of equal-weight buttons.
//
// Behaviour:
//   pressed   → branchViewMode === 'worktrees' (filter on, only
//                branches that own a worktree path render)
//   unpressed → branchViewMode === 'all'       (no filter)
// The underlying store action `setBranchViewMode` is unchanged;
// BranchNavigator / persistence / refresh continue to read
// `repo.ui.branchViewMode` as before.

import { FolderTree, ListTree, type LucideIcon } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'

interface Props {
  value: BranchViewMode
  disabled?: boolean
  onChange: (viewMode: BranchViewMode) => void
}

export function BranchViewModeControl({ value, disabled = false, onChange }: Props) {
  const t = useT()
  const worktreesOnly = value === 'worktrees'
  // Icon reflects the *current* state: ListTree when the full
  // list is shown, FolderTree when only worktree-bearing
  // branches are. Mirrors the i18n labels under those keys.
  const Icon: LucideIcon = worktreesOnly ? FolderTree : ListTree
  // The tooltip uses the verbose form ("All branches" / "Worktree
  // branches") so the icon-only button is self-explanatory; the
  // short keys (`branches.filter.*`) are intentionally not used.
  const labelKey = worktreesOnly ? 'branches.filter-tooltip.worktrees' : 'branches.filter-tooltip.all'
  const label = t(labelKey)

  return (
    <Tip label={label}>
      <Button
        variant="ghost"
        size="icon-lg"
        disabled={disabled}
        onClick={() => onChange(worktreesOnly ? 'all' : 'worktrees')}
        aria-pressed={worktreesOnly}
        aria-label={t('branches.filter-label')}
        className={cn(
          // Match the topbar toggle pressed treatment so the controls
          // read as one family. `hover:bg-accent`
          // sticks while pressed so the active state doesn't
          // flicker back to ghost on mouse-over.
          worktreesOnly && 'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Icon />
      </Button>
    </Tip>
  )
}
