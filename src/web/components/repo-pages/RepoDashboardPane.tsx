import { LayoutDashboard } from 'lucide-react'
import { RepoPageToolbar } from '#/web/components/repo-pages/RepoPageToolbar.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface RepoDashboardPaneProps {
  trafficLightOffset?: boolean
}

export function RepoDashboardPane({ trafficLightOffset = false }: RepoDashboardPaneProps) {
  const t = useT()
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <RepoPageToolbar icon={LayoutDashboard} label={t('repo.dashboard')} trafficLightOffset={trafficLightOffset} />
      <div className="min-h-0 flex-1" />
    </section>
  )
}
