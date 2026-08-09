import { RefreshCw } from '@lucide/vue'
import { computed, defineComponent, ref } from 'vue'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const WorkspaceRefreshAction = defineComponent<{ workspaceId: string }>({
  name: 'WorkspaceRefreshAction',
  props: { workspaceId: { type: String, required: true } },

  setup(props) {
    const t = useT()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspaceId = computed(() => canonicalWorkspaceLocator(props.workspaceId))
    const workspaceRuntimeId = computed(() => {
      const id = workspaceId.value
      return id ? (workspaces.value[id]?.workspaceRuntimeId ?? null) : null
    })
    const refreshing = ref(false)

    async function handleRefresh(): Promise<void> {
      const runtimeId = workspaceRuntimeId.value
      const id = workspaceId.value
      if (!id || !runtimeId || refreshing.value) return
      refreshing.value = true
      try {
        const outcome = await runWorkspaceRefresh(
          { get: workspacesStore.getState, set: workspacesStore.setState },
          id,
          { workspaceRuntimeId: runtimeId },
        )
        presentWorkspaceRefreshOutcome(outcome, t)
      } finally {
        refreshing.value = false
      }
    }

    return () => (
      <Tip label={t('menu.view.refresh')}>
        <AsyncButton
          variant="ghost"
          size="icon-lg"
          disabled={!workspaceRuntimeId.value || refreshing.value}
          loading={refreshing.value}
          aria-label={t('menu.view.refresh')}
          action={handleRefresh}
        >
          <RefreshCw aria-hidden="true" />
        </AsyncButton>
      </Tip>
    )
  },
})
