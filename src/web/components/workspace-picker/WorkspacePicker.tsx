import { Download, FolderOpen, Plus, Server } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
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
  labels: WorkspacePickerLabels
  onActivate: (id: WorkspaceId, onCommit?: () => void) => void
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
    'labels',
    'onActivate',
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
      const source = document.activeElement
      props.onActivate(nextWorkspace.id, () => {
        if (document.activeElement === source) focusRegistry.focus(nextWorkspace.id)
      })
    }

    return () => {
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
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-interactive
                  aria-label={props.labels.open}
                  title={props.labels.open}
                  class="text-muted-foreground"
                >
                  <Plus class="size-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
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
