import { defineComponent } from 'vue'
import { CalendarClock, File, Folder, FolderTree } from '@lucide/vue'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { StatusChip, StatusLink, StatusRow, StatusRows } from '#/web/components/workspace-pane/status-ui.tsx'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

interface WorkspaceDirectoryStatusProps {
  overview: WorkspaceDirectoryOverview
  workingDirectory: string
  onOpenFiles: () => void
}

export const WorkspaceDirectoryStatus = defineComponent<WorkspaceDirectoryStatusProps>({
  name: 'WorkspaceDirectoryStatus',
  props: ['overview', 'workingDirectory', 'onOpenFiles'],
  setup(props) {
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)
    return () => {
      const lastModifiedLabel = formatRelativeTime(props.overview.lastModifiedAt, lang.value)
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
                onClick={props.onOpenFiles}
              >
                {props.workingDirectory}
              </StatusLink>
            }
            valueLayout="inline"
            tone="brand"
          />
          <StatusRow
            icon={<File size={14} />}
            label={t('dashboard.directory.files')}
            value={<StatusChip>{props.overview.topLevelFileCount}</StatusChip>}
            valueLayout="inline"
          />
          <StatusRow
            icon={<Folder size={14} />}
            label={t('dashboard.directory.folders')}
            value={<StatusChip>{props.overview.topLevelDirectoryCount}</StatusChip>}
            valueLayout="inline"
          />
          <StatusRow
            icon={<CalendarClock size={14} />}
            label={t('dashboard.directory.last-modified')}
            value={
              <StatusChip class="min-w-0 max-w-full shrink truncate" title={lastModifiedLabel}>
                {lastModifiedLabel}
              </StatusChip>
            }
            valueLayout="inline"
          />
        </StatusRows>
      )
    }
  },
})
