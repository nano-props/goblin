import { FolderTree, ListTree, type LucideIcon } from 'lucide-react'
import { Tip } from '#/web/components/Tip.tsx'
import { SegmentedControl } from '#/web/components/ui/segmented-control.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { BRANCH_VIEW_MODE_OPTIONS } from '#/web/components/repo-toolbar/branch-view-mode-options.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'

interface Props {
  value: BranchViewMode
  disabled?: boolean
  onChange: (viewMode: BranchViewMode) => void
}

const BRANCH_VIEW_MODE_ICONS = {
  all: ListTree,
  worktrees: FolderTree,
} satisfies Record<BranchViewMode, LucideIcon>

export function BranchViewModeControl({ value, disabled = false, onChange }: Props) {
  const t = useT()

  return (
    <SegmentedControl.Root
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as BranchViewMode)
      }}
      disabled={disabled}
      aria-label={t('branches.filter-label')}
    >
      {BRANCH_VIEW_MODE_OPTIONS.map((option) => {
        const Icon = BRANCH_VIEW_MODE_ICONS[option.id]
        const label = t(option.tooltipKey)
        return (
          <Tip key={option.id} label={label}>
            <SegmentedControl.Item value={option.id} aria-label={label}>
              <Icon />
            </SegmentedControl.Item>
          </Tip>
        )
      })}
    </SegmentedControl.Root>
  )
}