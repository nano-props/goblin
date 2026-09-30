import { defineComponent } from 'vue'
import { useRoute } from 'vue-router'
import { WorkspaceOpenPage } from '#/web/components/WorkspaceOpenPage.tsx'

export const WorkspaceOpenRouteView = defineComponent({
  name: 'WorkspaceOpenRouteView',
  setup() {
    const route = useRoute()
    return () => <WorkspaceOpenPage key={route.fullPath} path={route.query.path} />
  },
})
