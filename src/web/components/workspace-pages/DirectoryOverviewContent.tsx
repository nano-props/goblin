import { File, Folder, HardDrive } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatByteSize } from '#/web/lib/format-byte-size.ts'
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
  const sizeAvailable = overview.totalSizeBytes !== null
  const sizeDetailKey = sizeAvailable ? 'dashboard.directory.total-size' : 'dashboard.directory.size-unavailable'
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
        icon={HardDrive}
        label={t('dashboard.directory.size')}
        value={sizeAvailable ? formatByteSize(overview.totalSizeBytes) : '—'}
        detail={t(sizeDetailKey)}
      />
    </div>
  )
}
