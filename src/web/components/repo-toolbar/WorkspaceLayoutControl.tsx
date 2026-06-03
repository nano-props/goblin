import { PanelLeft, PanelTop, type LucideIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { segmentedItemClass } from '#/web/components/repo-toolbar/segmented-control.ts'
import { WORKSPACE_LAYOUTS } from '#/shared/workspace-layout.ts'
interface Props {
  value: RepoWorkspaceLayout
  onChange: (layout: RepoWorkspaceLayout) => void
}

const WORKSPACE_LAYOUT_TOOLTIP_KEYS = {
  'top-bottom': 'workspace.layout-tooltip.top-bottom',
  'left-right': 'workspace.layout-tooltip.left-right',
} satisfies Record<RepoWorkspaceLayout, string>

const WORKSPACE_LAYOUT_OPTIONS = WORKSPACE_LAYOUTS.map((id) => ({
  id,
  tooltipKey: WORKSPACE_LAYOUT_TOOLTIP_KEYS[id],
}))

const WORKSPACE_LAYOUT_ICONS = {
  'top-bottom': PanelTop,
  'left-right': PanelLeft,
} satisfies Record<RepoWorkspaceLayout, LucideIcon>

export function WorkspaceLayoutControl({ value, onChange }: Props) {
  const t = useT()

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as RepoWorkspaceLayout)
      }}
      aria-label={t('workspace.layout-label')}
      variant="outline"
      size="sm"
      className="shrink-0"
    >
      {WORKSPACE_LAYOUT_OPTIONS.map((option) => {
        const Icon = WORKSPACE_LAYOUT_ICONS[option.id]
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
