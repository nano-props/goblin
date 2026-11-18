import { Download, FolderOpen, Plus, Server } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { defineComponent, onMounted, ref, watch } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { NAVIGATOR_ROW_LIST_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import { NavigatorSectionHeader } from '#/web/components/workspace-navigator/NavigatorSectionHeader.tsx'
import { ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { WorkspacePickerRow } from '#/web/components/workspace-picker/WorkspacePickerRow.tsx'
import type { WorkspacePickerItem, WorkspacePickerLabels } from '#/web/components/workspace-picker/types.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

interface WorkspacePickerProps {
  workspaces: WorkspacePickerItem[]
  currentWorkspaceId: WorkspaceId | null
  labels: WorkspacePickerLabels
  onActivate: (id: WorkspaceId) => void
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

    function revealCurrentWorkspace(): void {
      const id = props.currentWorkspaceId
      if (id) focusRegistry.getRef(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }

    onMounted(revealCurrentWorkspace)
    watch(() => props.currentWorkspaceId, revealCurrentWorkspace, { flush: 'post' })

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
      props.onActivate(nextWorkspace.id)
      focusRegistry.focus(nextWorkspace.id)
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
            <PopoverContent
              align="end"
              aria-label={props.labels.open}
              class="w-max max-w-[calc(100vw-2rem)] overflow-hidden p-0"
            >
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
            <ScrollArea class="max-h-[min(10.5rem,26dvh)]">
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
            </ScrollArea>
          ) : null}
        </nav>
      )
    }
  },
})
