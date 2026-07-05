import { LayoutDashboard } from 'lucide-react'
import { RepoPagePane } from '#/web/components/repo-pages/RepoPagePane.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface RepoDashboardPaneProps {
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
}

export function RepoDashboardPane({ compact = false, trafficLightOffset = false, onBack }: RepoDashboardPaneProps) {
  const t = useT()
  return (
    <RepoPagePane
      icon={LayoutDashboard}
      label={t('repo.dashboard')}
      compact={compact}
      trafficLightOffset={trafficLightOffset}
      onBack={onBack}
    >
      <div className="min-h-0 flex-1" />
    </RepoPagePane>
  )
}
