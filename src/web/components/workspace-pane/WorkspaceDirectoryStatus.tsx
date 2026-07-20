import { File, Folder, HardDrive } from 'lucide-react'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { StatusChip, StatusRow, StatusRows } from '#/web/components/workspace-pane/status-ui.tsx'
import { formatByteSize } from '#/web/lib/format-byte-size.ts'
import { useT } from '#/web/stores/i18n.ts'

export function WorkspaceDirectoryStatus({ overview }: { overview: WorkspaceDirectoryOverview }) {
  const t = useT()
  const size = overview.totalSizeBytes === null ? '—' : formatByteSize(overview.totalSizeBytes)
  return (
    <StatusRows>
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
        icon={<HardDrive size={14} />}
        label={t('dashboard.directory.size')}
        value={<StatusChip>{size}</StatusChip>}
        valueLayout="inline"
      />
    </StatusRows>
  )
}
