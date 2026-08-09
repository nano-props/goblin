import { CalendarClock, File, Folder } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { DashboardMetricCard } from '#/web/components/workspace-pages/dashboard-ui.tsx'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { cn } from '#/web/lib/cn.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface DirectoryOverviewContentProps {
  overview: WorkspaceDirectoryOverview
  compact?: boolean
}

export const DirectoryOverviewContent = defineComponent<DirectoryOverviewContentProps>({
  name: 'DirectoryOverviewContent',
  props: ['overview', 'compact'],
  setup(props) {
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)
    return () => {
      const lastModifiedLabel = formatRelativeTime(props.overview.lastModifiedAt, lang.value)
      return (
        <div class={cn('grid gap-2', props.compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
          <DashboardMetricCard
            icon={File}
            label={t('dashboard.directory.files')}
            value={props.overview.topLevelFileCount}
            detail={t('dashboard.directory.top-level')}
          />
          <DashboardMetricCard
            icon={Folder}
            label={t('dashboard.directory.folders')}
            value={props.overview.topLevelDirectoryCount}
            detail={t('dashboard.directory.top-level')}
          />
          <DashboardMetricCard
            icon={CalendarClock}
            label={t('dashboard.directory.last-modified')}
            value={lastModifiedLabel}
            valueClass="min-w-0 shrink truncate text-sm"
            valueTitle={lastModifiedLabel}
          />
        </div>
      )
    }
  },
})
