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
