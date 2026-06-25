import { PanelLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

export function WorkspaceFocusToggle() {
  const t = useT()
  const workspaceFocused = useReposStore((s) => s.workspaceFocused)
  const toggleWorkspaceFocused = useReposStore((s) => s.toggleWorkspaceFocused)
  const label = t('workspace.focus-toggle-tooltip.enable')
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={toggleWorkspaceFocused}
      aria-pressed={workspaceFocused}
      aria-label={t('workspace.focus-toggle-label')}
      title={workspaceFocused ? undefined : label}
    >
      <PanelLeft />
    </Button>
  )
}
