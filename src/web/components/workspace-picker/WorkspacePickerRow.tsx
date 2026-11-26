import { AlertCircle, ArrowDownToLine, ArrowUpToLine, Folder, FolderGit2, Loader2, Server, X } from '@lucide/vue'
import { defineComponent, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceOrderEdge } from '#/shared/workspace-order.ts'
import { isRemoteWorkspaceId, remoteWorkspaceConnectionTarget } from '#/shared/remote-workspace.ts'
import { ActionPopover, ActionPopoverItem } from '#/web/components/ActionPopover.tsx'
import { toButtonVNodeRef } from '#/web/components/ui/refs.ts'
import { focusRing } from '#/web/components/ui/focus.ts'
import {
  NAVIGATOR_ROW_CONTENT_BUTTON_CLASS,
  NAVIGATOR_ROW_LABEL_CLASS,
} from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
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
  moveFirstLabel: string
  moveLastLabel: string
  refreshOrder: (signal: AbortSignal) => Promise<readonly WorkspaceId[] | null>
  movePending: boolean
  onMove: (edge: WorkspaceOrderEdge) => void
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
    'moveFirstLabel',
    'moveLastLabel',
    'refreshOrder',
    'movePending',
    'onMove',
    'buttonRef',
    'onActivate',
    'onOpenDashboard',
    'onClose',
    'onKeydown',
  ],

  setup(props) {
    const t = useT()
    const menuOpen = ref(false)
    const order = ref<readonly WorkspaceId[] | null>(null)
    const loadingOrder = ref(false)

    watch([menuOpen, () => props.movePending], async ([open, moving], _, onCleanup) => {
      order.value = null
      loadingOrder.value = false
      if (!open || moving) return

      const request = new AbortController()
      onCleanup(() => request.abort())
      loadingOrder.value = true
      try {
        const workspaceOrder = await props.refreshOrder(request.signal)
        if (!request.signal.aborted) order.value = workspaceOrder
      } catch {
        if (!request.signal.aborted) toast.error(t('workspace-picker.order-load-failed'))
      } finally {
        if (!request.signal.aborted) loadingOrder.value = false
      }
    })

    const moveActions = [
      { edge: 'first', icon: ArrowUpToLine },
      { edge: 'last', icon: ArrowDownToLine },
    ] as const

    return () => {
      const workspace = props.workspace
      const workspaceOrder = order.value
      const orderIndex = workspaceOrder?.indexOf(workspace.id) ?? -1
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
              class={cn(NAVIGATOR_ROW_CONTENT_BUTTON_CLASS, focusRing)}
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
                    <div class="space-y-0.5 p-1">
                      {moveActions.map(({ edge, icon: MoveIcon }) => (
                        <ActionPopoverItem
                          key={edge}
                          label={edge === 'first' ? props.moveFirstLabel : props.moveLastLabel}
                          icon={<MoveIcon aria-hidden="true" />}
                          busy={loadingOrder.value}
                          disabled={
                            props.movePending ||
                            !workspaceOrder ||
                            orderIndex === -1 ||
                            orderIndex === (edge === 'first' ? 0 : workspaceOrder.length - 1)
                          }
                          onSelect={() => {
                            close()
                            props.onMove(edge)
                          }}
                        />
                      ))}
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
