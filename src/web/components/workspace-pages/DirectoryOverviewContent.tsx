import { CalendarClock, File, Folder } from 'lucide-react'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { DashboardMetricCard } from '#/web/components/workspace-pages/dashboard-ui.tsx'

export function DirectoryOverviewContent({
  overview,
  compact = false,
}: {
  overview: WorkspaceDirectoryOverview
  compact?: boolean
}) {
  const t = useT()
  const lang = useI18nStore((state) => state.lang)
  const lastModifiedLabel = formatRelativeTime(overview.lastModifiedAt, lang)
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      <DashboardMetricCard
        icon={File}
        label={t('dashboard.directory.files')}
        value={overview.topLevelFileCount}
        detail={t('dashboard.directory.top-level')}
      />
      <DashboardMetricCard
        icon={Folder}
        label={t('dashboard.directory.folders')}
        value={overview.topLevelDirectoryCount}
        detail={t('dashboard.directory.top-level')}
      />
      <DashboardMetricCard
        icon={CalendarClock}
        label={t('dashboard.directory.last-modified')}
        value={lastModifiedLabel}
        valueClassName="min-w-0 shrink truncate text-sm"
        valueTitle={lastModifiedLabel}
      />
    </div>
  )
}
