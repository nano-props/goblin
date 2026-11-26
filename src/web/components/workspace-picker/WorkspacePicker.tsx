import { Download, FolderOpen, List, ListFilter, Plus, Server } from '@lucide/vue'
import { PopoverAnchor, PopoverTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { WorkspaceOrderEdge } from '#/shared/workspace-order.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { NAVIGATOR_ROW_LIST_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import { NavigatorSectionHeader } from '#/web/components/workspace-navigator/NavigatorSectionHeader.tsx'
import { ACTION_POPOVER_CONTENT_CLASS, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { WorkspacePickerRow } from '#/web/components/workspace-picker/WorkspacePickerRow.tsx'
import type { WorkspacePickerItem, WorkspacePickerLabels } from '#/web/components/workspace-picker/types.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

interface WorkspacePickerProps {
  workspaces: WorkspacePickerItem[]
  currentWorkspaceId: WorkspaceId | null
  showActiveWorkspaceOnly: boolean
  onShowActiveWorkspaceOnlyChange: (enabled: boolean) => void
  labels: WorkspacePickerLabels
  onActivate: (id: WorkspaceId, onCommit?: () => void) => void
  onOpenDashboard: (id: WorkspaceId) => void
  refreshOrder: (signal: AbortSignal) => Promise<readonly WorkspaceId[] | null>
  movePending: boolean
  onMove: (id: WorkspaceId, edge: WorkspaceOrderEdge) => void
  onClose: (id: WorkspaceId) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
}

export const WorkspacePicker = defineComponent<WorkspacePickerProps>({
  name: 'WorkspacePicker',
  props: [
    'workspaces',
    'currentWorkspaceId',
    'showActiveWorkspaceOnly',
    'onShowActiveWorkspaceOnlyChange',
    'labels',
    'onActivate',
    'onOpenDashboard',
    'refreshOrder',
    'movePending',
    'onMove',
    'onClose',
    'onOpenLocal',
    'onOpenRemote',
    'onClone',
  ],

  setup(props) {
    const compact = useIsCompactUi()
    const menuOpen = ref(false)
    const focusRegistry = useFocusRegistry<WorkspaceId, HTMLButtonElement>()

    function navigateWorkspace(event: KeyboardEvent, index: number): void {
      const count = props.workspaces.length
      const nextIndex =
        event.key === 'ArrowUp'
          ? (index + count - 1) % count
          : event.key === 'ArrowDown'
            ? (index + 1) % count
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? count - 1
                : -1
      const nextWorkspace = props.workspaces[nextIndex]
      if (!nextWorkspace || event.defaultPrevented) return
      event.preventDefault()
      if (nextIndex === index) return
      const source = document.activeElement
      props.onActivate(nextWorkspace.id, () => {
        if (document.activeElement === source) focusRegistry.focus(nextWorkspace.id)
      })
    }

    return () => {
      const activeOnly = props.showActiveWorkspaceOnly
      const FilterIcon = activeOnly ? ListFilter : List
      const actions = [
        { label: props.labels.openLocal, icon: FolderOpen, select: props.onOpenLocal },
        { label: props.labels.openRemote, icon: Server, select: props.onOpenRemote },
        { label: props.labels.clone, icon: Download, select: props.onClone },
      ]

      return (
        <nav class="flex min-w-0 flex-col" aria-label={props.labels.workspaces}>
          <Popover
            open={menuOpen.value}
            onOpenChange={(open) => {
              menuOpen.value = open
            }}
          >
            <NavigatorSectionHeader title={props.labels.workspaces}>
              <Tip label={props.labels.filterStatus}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  data-interactive
                  aria-label={props.labels.filter}
                  aria-description={props.labels.filterStatus}
                  aria-pressed={activeOnly}
                  onClick={() => props.onShowActiveWorkspaceOnlyChange(!activeOnly)}
                  class={
                    activeOnly
                      ? 'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground'
                      : undefined
                  }
                >
                  <FilterIcon aria-hidden="true" />
                </Button>
              </Tip>
              {/* The tooltip has its own positioning context. Anchor the menu outside it. */}
              <PopoverAnchor as="span" class="inline-flex shrink-0">
                <Tip label={props.labels.open}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      data-interactive
                      aria-label={props.labels.open}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>
                </Tip>
              </PopoverAnchor>
            </NavigatorSectionHeader>
            <PopoverContent align="end" aria-label={props.labels.open} class={ACTION_POPOVER_CONTENT_CLASS}>
              <div class="space-y-0.5 p-1">
                {actions.map(({ label, icon: Icon, select }) => (
                  <ActionPopoverItem
                    key={label}
                    label={label}
                    title={label}
                    icon={<Icon aria-hidden="true" />}
                    onSelect={() => {
                      menuOpen.value = false
                      select()
                    }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {props.workspaces.length > 0 ? (
            <ul class={NAVIGATOR_ROW_LIST_CLASS}>
              {props.workspaces.map((workspace, index) => (
                <WorkspacePickerRow
                  key={workspace.id}
                  workspace={workspace}
                  selected={workspace.id === props.currentWorkspaceId}
                  compact={compact.value}
                  unavailableLabel={props.labels.unavailable}
                  closeLabel={props.labels.close}
                  buttonRef={focusRegistry.setRef(workspace.id)}
                  onActivate={() => props.onActivate(workspace.id)}
                  onOpenDashboard={() => props.onOpenDashboard(workspace.id)}
                  moveFirstLabel={props.labels.moveFirst}
                  moveLastLabel={props.labels.moveLast}
                  refreshOrder={props.refreshOrder}
                  movePending={props.movePending}
                  onMove={(edge) => props.onMove(workspace.id, edge)}
                  onClose={() => props.onClose(workspace.id)}
                  onKeydown={(event) => navigateWorkspace(event, index)}
                />
              ))}
            </ul>
          ) : null}
        </nav>
      )
    }
  },
})
