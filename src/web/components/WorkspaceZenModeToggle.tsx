import { PanelLeft } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { HTMLAttributes } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const WorkspaceZenModeToggle = defineComponent<{ class?: HTMLAttributes['class'] }>({
  name: 'WorkspaceZenModeToggle',
  inheritAttrs: false,
  props: { class: null },
  setup(props, { attrs }) {
    const t = useT()
    const zenMode = useStoreSelector(workspacesStore, (state) => state.zenMode)
    const toggleZenMode = workspacesStore.getState().toggleZenMode
    return () => (
      <Button
        {...attrs}
        type="button"
        variant="ghost"
        size="icon-lg"
        onClick={toggleZenMode}
        aria-pressed={zenMode.value}
        aria-label={t('workspace.zen-mode-toggle-label')}
        title={zenMode.value ? undefined : t('workspace.zen-mode-toggle-tooltip.enable')}
        class={props.class}
      >
        <PanelLeft />
      </Button>
    )
  },
})
