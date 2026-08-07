import { CalendarClock, File, Folder, FolderTree } from 'lucide-react'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { StatusChip, StatusLink, StatusRow, StatusRows } from '#/web/components/workspace-pane/status-ui.tsx'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'

export function WorkspaceDirectoryStatus({
  overview,
  workingDirectory,
  onOpenFiles,
}: {
  overview: WorkspaceDirectoryOverview
  workingDirectory: string
  onOpenFiles: () => void
}) {
  const t = useT()
  const lang = useI18nStore((state) => state.lang)
  const lastModifiedLabel = formatRelativeTime(overview.lastModifiedAt, lang)
  return (
    <StatusRows>
      <StatusRow
        icon={<FolderTree size={14} />}
        label={t('dashboard.directory.working-directory')}
        value={
          <StatusLink
            mono
            truncate
            aria-label={t('dashboard.directory.open-files')}
            title={t('dashboard.directory.open-files')}
            onClick={onOpenFiles}
          >
            {workingDirectory}
          </StatusLink>
        }
        valueLayout="inline"
        tone="brand"
      />
      <StatusRow
        icon={<File size={14} />}
        label={t('dashboard.directory.files')}
        value={<StatusChip>{overview.topLevelFileCount}</StatusChip>}
        valueLayout="inline"
      />
      <StatusRow
        icon={<Folder size={14} />}
        label={t('dashboard.directory.folders')}
        value={<StatusChip>{overview.topLevelDirectoryCount}</StatusChip>}
        valueLayout="inline"
      />
      <StatusRow
        icon={<CalendarClock size={14} />}
        label={t('dashboard.directory.last-modified')}
        value={
          <StatusChip className="min-w-0 max-w-full shrink truncate" title={lastModifiedLabel}>
            {lastModifiedLabel}
          </StatusChip>
        }
        valueLayout="inline"
      />
    </StatusRows>
  )
}
