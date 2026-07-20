import { LayoutDashboard } from 'lucide-react'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface WorkspaceDashboardRowActionProps {
  selected?: boolean
  onOpenDashboard?: () => void
}

export function WorkspaceDashboardRowAction({ selected = false, onOpenDashboard }: WorkspaceDashboardRowActionProps) {
  const t = useT()
  return (
    <SidebarRowButton
      onClick={() => onOpenDashboard?.()}
      aria-label={t('workspace.dashboard')}
      size="dense"
      selected={selected}
      leading={<LayoutDashboard size={16} />}
    >
      {t('workspace.dashboard')}
    </SidebarRowButton>
  )
}
