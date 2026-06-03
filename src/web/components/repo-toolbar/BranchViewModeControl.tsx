import { FolderTree, GitBranch, ListTree, type LucideIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { BRANCH_VIEW_MODE_OPTIONS } from '#/web/components/repo-toolbar/branch-view-mode-options.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { segmentedItemClass } from '#/web/components/repo-toolbar/segmented-control.ts'
interface Props {
  value: BranchViewMode
  disabled?: boolean
  onChange: (viewMode: BranchViewMode) => void
}

const BRANCH_VIEW_MODE_ICONS = {
  all: ListTree,
  worktrees: FolderTree,
  'no-worktree': GitBranch,
} satisfies Record<BranchViewMode, LucideIcon>

export function BranchViewModeControl({ value, disabled = false, onChange }: Props) {
  const t = useT()

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as BranchViewMode)
      }}
      disabled={disabled}
      aria-label={t('branches.filter-label')}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      {BRANCH_VIEW_MODE_OPTIONS.map((option) => {
        const Icon = BRANCH_VIEW_MODE_ICONS[option.id]
        const label = t(option.tooltipKey)
        const selected = option.id === value
        return (
          <Tip key={option.id} label={label}>
            <ToggleGroupItem value={option.id} aria-label={label} className={segmentedItemClass(selected)}>
              <Icon />
            </ToggleGroupItem>
          </Tip>
        )
      })}
    </ToggleGroup>
  )
}
