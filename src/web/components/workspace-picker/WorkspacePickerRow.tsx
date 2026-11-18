import { AlertCircle, Folder, FolderGit2, Loader2, Server, X } from '@lucide/vue'
import { defineComponent, ref } from 'vue'
import { isRemoteWorkspaceId, remoteWorkspaceConnectionTarget } from '#/shared/remote-workspace.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { toButtonVNodeRef } from '#/web/components/ui/refs.ts'
import { focusRing } from '#/web/components/ui/focus.ts'
import { NAVIGATOR_ROW_LABEL_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import { NavigatorRow } from '#/web/components/workspace-navigator/NavigatorRow.tsx'
import { NavigatorRowActionSlot } from '#/web/components/workspace-navigator/NavigatorRowActionSlot.tsx'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { TerminalBellBadge } from '#/web/terminal/components/TerminalBellBadge.tsx'

interface WorkspacePickerRowProps {
  workspace: WorkspacePickerItem
  selected: boolean
  compact: boolean
  unavailableLabel: string
  closeLabel: string
  buttonRef: (node: HTMLButtonElement | null) => void
  onActivate: () => void
  onOpenDashboard: () => void
  onClose: () => void
  onKeydown: (event: KeyboardEvent) => void
}

export const WorkspacePickerRow = defineComponent<WorkspacePickerRowProps>({
  name: 'WorkspacePickerRow',
  props: [
    'workspace',
    'selected',
    'compact',
    'unavailableLabel',
    'closeLabel',
    'buttonRef',
    'onActivate',
    'onOpenDashboard',
    'onClose',
    'onKeydown',
  ],

  setup(props) {
    const t = useT()
    const menuOpen = ref(false)

    return () => {
      const workspace = props.workspace
      const count = workspace.terminalBellCount ?? 0
      const connecting = workspace.lifecycle?.kind === 'connecting'
      const failed = workspace.lifecycle?.kind === 'failed'
      const connectingTitle = t('workspace-picker.connecting-title')
      const location = formatWorkspaceDisplayLocation(
        workspace.id,
        remoteWorkspaceConnectionTarget(workspace.lifecycle),
      )
      const label = [
        workspace.name,
        connecting ? connectingTitle : failed ? props.unavailableLabel : null,
        count > 0 ? t('terminal.bell-unread-count', { count }) : null,
      ]
        .filter(Boolean)
        .join(' — ')
      const Icon = isRemoteWorkspaceId(workspace.id) ? Server : workspace.gitAvailable ? FolderGit2 : Folder

      return (
        <NavigatorRow
          selected={props.selected}
          onClick={props.onActivate}
          onDblclick={props.onOpenDashboard}
          content={
            <button
              ref={toButtonVNodeRef(props.buttonRef)}
              type="button"
              data-interactive
              class={cn(
                'pointer-events-auto flex min-w-0 flex-1 cursor-pointer touch-manipulation items-center gap-1.5 rounded-sm text-left outline-none',
                focusRing,
              )}
              aria-current={props.selected ? 'true' : undefined}
              aria-label={label}
              aria-description={location}
              title={location}
              onKeydown={props.onKeydown}
            >
              <span class="flex w-4 shrink-0 items-center justify-center">
                {props.compact && count > 0 ? (
                  <TerminalBellBadge count={count} />
                ) : (
                  <Icon
                    size={14}
                    class={props.selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span
                class={cn(
                  NAVIGATOR_ROW_LABEL_CLASS,
                  'uppercase',
                  props.selected ? 'text-selected-foreground' : 'text-foreground',
                )}
              >
                {workspace.name}
              </span>
              {connecting ? (
                <Loader2 size={12} class="shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : null}
              {failed ? <AlertCircle size={12} class="shrink-0 text-warning" aria-hidden="true" /> : null}
            </button>
          }
          actions={
            <NavigatorRowActionSlot
              actionHidden={!(props.compact || menuOpen.value)}
              terminalBellCount={props.compact ? 0 : count}
              terminalOutputActive={false}
              action={
                <ActionPopover
                  label={t('action.menu')}
                  focusContentOnOpen
                  open={menuOpen.value}
                  onOpenChange={(open) => {
                    menuOpen.value = open
                  }}
                >
                  {({ close }: { close: () => void }) => (
                    <div class="p-1">
                      <ActionPopoverItem
                        label={props.closeLabel}
                        icon={<X aria-hidden="true" />}
                        destructive
                        onSelect={() => {
                          close()
                          props.onClose()
                        }}
                      />
                    </div>
                  )}
                </ActionPopover>
              }
            />
          }
        />
      )
    }
  },
})
