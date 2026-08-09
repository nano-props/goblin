import { ArrowLeft } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { VNodeChild } from 'vue'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { Button } from '#/web/components/ui/button.tsx'
import {
  EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
  WorkspacePaneTabStrip,
} from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'

interface WorkspacePaneToolbarProps {
  workspacePaneTabTargetKey: string
  workspacePaneId: string
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  createAction: WorkspacePaneRuntimeTabCreateAction | null
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
  trailingActions?: VNodeChild
  onSelect: (item: WorkspacePaneTabItem) => void
  onReselect: (item: WorkspacePaneTabItem) => void
  onClose: (item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}

export const WorkspacePaneToolbar = defineComponent<WorkspacePaneToolbarProps>({
  name: 'WorkspacePaneToolbar',
  props: [
    'workspacePaneTabTargetKey',
    'workspacePaneId',
    'items',
    'activeTabIdentity',
    'createAction',
    'trafficLightOffset',
    'onBackToNavigator',
    'trailingActions',
    'onSelect',
    'onReselect',
    'onClose',
    'onReorder',
  ],

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()

    return () => {
      const backLabel = t('workspace.back-to-workspace-navigator')
      return (
        <WorkspaceToolbar draggable={!compact.value} trafficLightOffset={props.trafficLightOffset ?? false}>
          <WorkspaceToolbarLeadingSpacer reserve={props.trafficLightOffset ?? false} />
          <WorkspaceToolbarContent>
            <WorkspaceToolbarPrimary>
              {compact.value ? (
                <Tip label={backLabel}>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    onClick={props.onBackToNavigator}
                    disabled={!props.onBackToNavigator}
                    aria-label={backLabel}
                    title={backLabel}
                  >
                    <ArrowLeft size={14} />
                  </Button>
                </Tip>
              ) : null}
              <WorkspacePaneTabStrip
                workspacePaneTabTargetKey={props.workspacePaneTabTargetKey}
                items={props.items}
                workspacePaneId={props.workspacePaneId}
                activeTabIdentity={props.activeTabIdentity}
                responsiveCompact={compact.value}
                panelActive
                focusRegistry={focusRegistry}
                emptyFocusKey={EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY}
                createAction={props.createAction}
                onSelect={props.onSelect}
                onReselect={props.onReselect}
                onClose={props.onClose}
                onReorder={props.onReorder}
                activateKeyboardNavigationSelection
              />
            </WorkspaceToolbarPrimary>
            {props.trailingActions ? (
              <WorkspaceToolbarActions data-workspace-toolbar-trailing-actions="">
                {props.trailingActions}
              </WorkspaceToolbarActions>
            ) : null}
          </WorkspaceToolbarContent>
        </WorkspaceToolbar>
      )
    }
  },
})
