import { FileText, FolderTree, Terminal } from '@lucide/vue'
import { computed, defineComponent, ref } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import { workspaceTerminalAvailable } from '#/shared/workspace-runtime.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import {
  BRANCH_ROW_ACTION_BOX_CLASS,
  BRANCH_ROW_LIST_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { NavigatorRow } from '#/web/components/branch-navigator/NavigatorRow.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { runShowWorkspacePaneTabCommand, runTerminalPrimaryActionCommand } from '#/web/commands/workspace-commands.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

interface WorkspaceRootNavigatorProps {
  workspaceId: WorkspaceId
  selected: boolean
  onSelect?: () => void
}

/** The non-Git workspace root is a first-class navigation target, not a synthetic branch. */
export const WorkspaceRootNavigator = defineComponent<WorkspaceRootNavigatorProps>({
  name: 'WorkspaceRootNavigator',
  props: ['workspaceId', 'selected', 'onSelect'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const compact = useIsCompactUi()
    const menuOpen = ref(false)
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspace = computed(() => {
      const state = workspaces.value[props.workspaceId]
      const probe = state?.capability.probe
      return {
        name: workspaceNameFromLocator(props.workspaceId),
        terminalAvailable: workspaceTerminalAvailable(probe),
        workspaceRuntimeId: state?.workspaceRuntimeId ?? null,
        capabilities: probe?.status === 'ready' ? probe.capabilities : null,
      }
    })
    const commandTarget = computed(() => {
      const current = workspace.value
      if (!current.workspaceRuntimeId || !current.capabilities) return null
      const filesystemTarget = workspaceRootPaneFilesystemTarget({
        workspaceId: props.workspaceId,
        workspaceRuntimeId: current.workspaceRuntimeId,
        capabilities: current.capabilities,
      })
      return {
        routeTarget: { kind: 'workspace-root' as const, workspaceId: props.workspaceId },
        workspacePaneRoute: null,
        filesystemTarget,
      }
    })

    function showStaticTab(tab: 'status' | 'files'): void {
      if (!commandTarget.value) return
      void runShowWorkspacePaneTabCommand({
        workspaceId: props.workspaceId,
        target: commandTarget.value,
        tab,
        navigation,
      })
    }

    return () => {
      const currentWorkspace = workspace.value
      const target = commandTarget.value
      const actionVisible = compact.value || menuOpen.value
      return (
        <ScrollArea class="h-full min-h-0 flex-1" data-testid="workspace-root-navigator">
          <ul class={BRANCH_ROW_LIST_CLASS}>
            <NavigatorRow
              data-testid="workspace-root-row"
              selected={props.selected}
              onClick={props.onSelect}
              onDblclick={target ? () => showStaticTab('status') : undefined}
              contentClass="gap-2"
              content={
                <>
                  <FolderTree size={16} class="shrink-0 text-muted-foreground" />
                  <span class="min-w-0 flex-1 truncate text-sm" title={currentWorkspace.name}>
                    {currentWorkspace.name}
                  </span>
                </>
              }
              actions={
                <div class={BRANCH_ROW_ACTION_BOX_CLASS}>
                  <div
                    class={cn(
                      'relative',
                      actionVisible && 'pointer-events-auto opacity-100',
                      !actionVisible &&
                        'pointer-events-none opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                    )}
                  >
                    <ActionPopover
                      label={t('action.menu')}
                      open={menuOpen.value}
                      onOpenChange={(open) => {
                        menuOpen.value = open
                      }}
                    >
                      {({ close }: { close: () => void }) => (
                        <div class="space-y-0.5 p-1" role="list">
                          <WorkspaceAction
                            label={t('tab.status')}
                            icon={<FileText />}
                            close={close}
                            onSelect={target ? () => showStaticTab('status') : undefined}
                          />
                          <WorkspaceAction
                            label={t('tab.files')}
                            icon={<FolderTree />}
                            close={close}
                            onSelect={target ? () => showStaticTab('files') : undefined}
                          />
                          {currentWorkspace.terminalAvailable && target ? (
                            <WorkspaceAction
                              label={t('tab.terminal')}
                              icon={<Terminal />}
                              close={close}
                              onSelect={() => {
                                void runTerminalPrimaryActionCommand({
                                  workspaceId: props.workspaceId,
                                  target,
                                  navigation,
                                  t,
                                })
                              }}
                            />
                          ) : null}
                        </div>
                      )}
                    </ActionPopover>
                  </div>
                </div>
              }
            />
          </ul>
        </ScrollArea>
      )
    }
  },
})

interface WorkspaceActionProps {
  label: string
  icon: VNodeChild
  close: () => void
  onSelect?: () => void
}

const WorkspaceAction: FunctionalComponent<WorkspaceActionProps> = (props) => (
  <div role="listitem">
    <ActionPopoverItem
      label={props.label}
      icon={props.icon}
      disabled={!props.onSelect}
      onSelect={() => {
        props.close()
        props.onSelect?.()
      }}
    />
  </div>
)

WorkspaceAction.props = ['label', 'icon', 'close', 'onSelect']
