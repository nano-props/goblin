import { File, Folder, HardDrive, type LucideIcon } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'

const CARD_CLASS_NAME = 'rounded-lg border border-border/60 bg-card shadow-[var(--shadow-inset-highlight)]'

export function DirectoryOverviewContent({
  overview,
  compact = false,
}: {
  overview: WorkspaceDirectoryOverview
  compact?: boolean
}) {
  const t = useT()
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      <OverviewMetric
        icon={File}
        label={t('dashboard.directory.files')}
        value={overview.topLevelFileCount}
        detail={t('dashboard.directory.top-level')}
      />
      <OverviewMetric
        icon={Folder}
        label={t('dashboard.directory.folders')}
        value={overview.topLevelDirectoryCount}
        detail={t('dashboard.directory.top-level')}
      />
      <OverviewMetric
        icon={HardDrive}
        label={t('dashboard.directory.size')}
        value={formatByteSize(overview.totalSizeBytes)}
        detail={t('dashboard.directory.total-size')}
      />
    </div>
  )
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  detail: string
}) {
  return (
    <div className={cn(CARD_CLASS_NAME, 'flex min-w-0 items-center gap-3 p-3')}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
        <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`
}
