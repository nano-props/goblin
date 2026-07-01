import { PanelLeft } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

type WorkspaceZenModeToggleProps = Omit<
  ComponentProps<typeof Button>,
  'aria-label' | 'aria-pressed' | 'children' | 'onClick' | 'size' | 'title' | 'type' | 'variant'
>

export function WorkspaceZenModeToggle({ className, ref, ...props }: WorkspaceZenModeToggleProps) {
  const t = useT()
  const zenMode = useReposStore((s) => s.zenMode)
  const toggleZenMode = useReposStore((s) => s.toggleZenMode)
  const label = t('workspace.zen-mode-toggle-tooltip.enable')
  return (
    <Button
      {...props}
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-lg"
      onClick={toggleZenMode}
      aria-pressed={zenMode}
      aria-label={t('workspace.zen-mode-toggle-label')}
      title={zenMode ? undefined : label}
      className={className}
    >
      <PanelLeft />
    </Button>
  )
}
