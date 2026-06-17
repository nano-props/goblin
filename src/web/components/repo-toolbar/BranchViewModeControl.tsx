import { FolderTree, ListTree, type LucideIcon } from 'lucide-react'
import { Tip } from '#/web/components/Tip.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { BRANCH_VIEW_MODE_OPTIONS } from '#/web/components/repo-toolbar/branch-view-mode-options.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { cn } from '#/web/lib/cn.ts'

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
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as BranchViewMode)
      }}
      disabled={disabled}
      aria-label={t('branches.filter-label')}
      size="icon-sm"
      spacing={0.5}
      className={cn(
        'shrink-0 rounded-lg border border-separator bg-control p-0.5 shadow-[var(--shadow-control-inset-highlight)]',
        disabled && 'opacity-50',
      )}
    >
      {BRANCH_VIEW_MODE_OPTIONS.map((option) => {
        const Icon = BRANCH_VIEW_MODE_ICONS[option.id]
        const label = t(option.tooltipKey)
        return (
          <Tip key={option.id} label={label}>
            <span className="inline-flex">
              <ToggleGroupItem
                value={option.id}
                aria-label={label}
                className={cn(
                  'rounded-md border-0 bg-transparent text-muted-foreground shadow-none transition-[background-color,color,box-shadow]',
                  'hover:bg-accent hover:text-accent-foreground',
                  'data-[state=on]:bg-selected data-[state=on]:text-selected-foreground data-[state=on]:shadow-xs',
                  'data-[state=on]:hover:bg-selected data-[state=on]:hover:text-selected-foreground',
                )}
              >
                <Icon />
              </ToggleGroupItem>
            </span>
          </Tip>
        )
      })}
    </ToggleGroup>
  )
}
