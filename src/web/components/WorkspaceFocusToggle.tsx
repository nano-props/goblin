import { PanelLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

export function WorkspaceFocusToggle() {
  const t = useT()
  const workspaceFocused = useReposStore((s) => s.workspaceFocused)
  const toggleWorkspaceFocused = useReposStore((s) => s.toggleWorkspaceFocused)
  const label = t('workspace.focus-toggle-tooltip.enable')
  // Out of focus mode keep the plain text tooltip. In focus mode the
  // collapsed shell uses hover to reveal the sidebar, so the toggle
  // itself stays visually quiet and does not race that interaction
  // with another tooltip surface.
  const button = (
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
  if (workspaceFocused) return button
  return <Tip label={label}>{button}</Tip>
}
