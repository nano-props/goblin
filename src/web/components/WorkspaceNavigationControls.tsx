import { ArrowLeft, ArrowRight } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { HTMLAttributes, PropType } from 'vue'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const WorkspaceNavigationControls = defineComponent<{
  workspaceId?: string
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
  class?: HTMLAttributes['class']
}>({
  name: 'WorkspaceNavigationControls',
  inheritAttrs: false,
  props: {
    workspaceId: String,
    zenRevealTriggerEnabled: Boolean,
    onZenRevealTriggerEnter: Function as PropType<() => void>,
    class: null,
  },

  setup(props, { attrs }) {
    const t = useT()
    const navigation = useAppNavigation()
    const histories = useStoreSelector(workspacesStore, (state) => state.navigationHistoryByWorkspace)
    return () => {
      const workspaceId = canonicalWorkspaceLocator(props.workspaceId ?? '')
      const history = workspaceId ? histories.value[workspaceId] : undefined
      const canGoBack = !!history?.backStack.length
      const canGoForward = !!history?.forwardStack.length
      return (
        <div
          {...attrs}
          class={cn(
            'goblin-workspace-navigation-controls pointer-events-auto flex h-full items-center gap-1',
            props.class,
          )}
        >
          <span
            class="inline-flex"
            data-zen-reveal-surface={props.zenRevealTriggerEnabled ? '' : undefined}
            onMouseenter={props.zenRevealTriggerEnabled ? props.onZenRevealTriggerEnter : undefined}
          >
            <WorkspaceZenModeToggle data-testid="zen-mode-sidebar-trigger" />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={!workspaceId || !canGoBack}
            aria-label={t('workspace.navigation-back')}
            onClick={() => {
              if (workspaceId) navigation.goBack(workspaceId)
            }}
          >
            <ArrowLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={!workspaceId || !canGoForward}
            aria-label={t('workspace.navigation-forward')}
            onClick={() => {
              if (workspaceId) navigation.goForward(workspaceId)
            }}
          >
            <ArrowRight />
          </Button>
        </div>
      )
    }
  },
})
