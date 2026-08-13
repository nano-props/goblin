// Single-button worktree filter for the sidebar branch list. The previous
// SegmentedControl (all / worktrees) was hard to discover and the
// "blue pill" reading of the selected thumb (low-opacity accent
// tint) only ever landed muddy against the surrounding chrome. This
// control is now a single ghost toggle that paints a subtle accent
// fill when active.
//
// Behaviour:
//   pressed   → branchViewMode === 'worktrees' (filter on, only
//                branches that own a worktree path render)
//   unpressed → branchViewMode === 'all'       (no filter)
// The underlying store action `setBranchViewMode` is unchanged;
// GitWorkspaceNavigator / persistence / refresh continue to read
// The value is a restorable per-workspace client preference.

import { defineComponent } from 'vue'
import { FolderTree, ListTree } from '@lucide/vue'
import type { LucideIcon } from '@lucide/vue'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'
import type { BranchViewMode } from '#/shared/api-types.ts'

interface Props {
  value: BranchViewMode
  disabled?: boolean
  onChange: (viewMode: BranchViewMode) => void
}

export const BranchViewModeControl = defineComponent<Props>({
  name: 'BranchViewModeControl',
  props: ['value', 'disabled', 'onChange'],
  setup(props) {
    const t = useT()
    return () => {
      const worktreesOnly = props.value === 'worktrees'
      const Icon: LucideIcon = worktreesOnly ? FolderTree : ListTree
      const labelKey = worktreesOnly ? 'branches.filter-tooltip.worktrees' : 'branches.filter-tooltip.all'
      const label = t(labelKey)
      return (
        <Tip label={label}>
          <Button
            variant="ghost"
            size="icon-lg"
            disabled={props.disabled ?? false}
            onClick={() => props.onChange(worktreesOnly ? 'all' : 'worktrees')}
            aria-pressed={worktreesOnly}
            aria-label={t('branches.filter-label')}
            class={cn(
              worktreesOnly &&
                'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon />
          </Button>
        </Tip>
      )
    }
  },
})
