import { LayoutDashboard } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'

interface WorkspaceDashboardRowActionProps {
  selected?: boolean
  onOpenDashboard?: () => void
}

export const WorkspaceDashboardRowAction = defineComponent<WorkspaceDashboardRowActionProps>({
  name: 'WorkspaceDashboardRowAction',
  props: {
    selected: Boolean,
    onOpenDashboard: Function as PropType<() => void>,
  },

  setup(props) {
    const t = useT()
    return () => (
      <SidebarRowButton
        onClick={() => props.onOpenDashboard?.()}
        aria-label={t('workspace.dashboard')}
        size="dense"
        selected={props.selected ?? false}
        leading={<LayoutDashboard size={16} />}
      >
        {t('workspace.dashboard')}
      </SidebarRowButton>
    )
  },
})
