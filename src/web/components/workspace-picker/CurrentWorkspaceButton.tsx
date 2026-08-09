import { AlertCircle, ChevronDown, Folder, FolderGit2, Loader2, Server } from '@lucide/vue'
import { useForwardExpose } from 'reka-ui'
import { defineComponent, mergeProps } from 'vue'
import type { ButtonHTMLAttributes, FunctionalComponent, VNodeRef } from 'vue'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { toolbarTabChromeClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

const CURRENT_WORKSPACE_ICON_CLASS = 'flex size-3.5 shrink-0 items-center justify-center'

interface CurrentWorkspaceButtonBaseProps {
  workspace: WorkspacePickerItem
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onKeyboardNavigate: (id: WorkspaceId, direction: 'prev' | 'next' | 'first' | 'last') => void
  unavailableLabel: string
  terminalBellCount?: number
  fill?: boolean
}

interface CurrentWorkspaceToolbarButtonProps extends CurrentWorkspaceButtonBaseProps {
  isCurrent: boolean
  onActivate: (id: WorkspaceId) => void
}

type CurrentWorkspaceSidebarButtonProps = Omit<ButtonHTMLAttributes, 'children' | 'type'> &
  CurrentWorkspaceButtonBaseProps

export const CurrentWorkspaceToolbarButton = defineComponent<CurrentWorkspaceToolbarButtonProps>({
  name: 'CurrentWorkspaceToolbarButton',
  props: [
    'workspace',
    'isCurrent',
    'focusRegistry',
    'onActivate',
    'onKeyboardNavigate',
    'unavailableLabel',
    'terminalBellCount',
    'fill',
  ],

  setup(props) {
    const t = useT()
    return () => {
      const terminalBellCount = props.terminalBellCount ?? 0
      const unreadBellLabel =
        terminalBellCount > 0 ? t('terminal.bell-unread-count', { count: terminalBellCount }) : null
      const state = currentWorkspaceButtonState(props.workspace, props.unavailableLabel, unreadBellLabel)
      const connectingTitle = t('workspace-picker.connecting-title')
      return (
        <ToolbarClosableTab
          containerProps={{
            'data-interactive': true,
            'data-current-workspace-chrome': true,
          }}
          containerClass={cn(
            toolbarTabChromeClassName({
              variant: 'workspace-picker',
              active: props.isCurrent,
              compact: true,
            }),
            props.fill && 'max-w-none flex-1',
          )}
          buttonRef={props.focusRegistry?.setRef(props.workspace.id)}
          buttonProps={{
            'data-current-workspace-id': props.workspace.id,
            'data-current-workspace-connecting': state.showConnecting ? 'true' : undefined,
            role: 'tab',
            tabIndex: props.isCurrent ? 0 : -1,
            'aria-selected': props.isCurrent,
            'aria-label': state.workspaceLabel,
            onClick: () => props.onActivate(props.workspace.id),
            onKeydown: (event) =>
              handleWorkspaceKeyboardNavigation(event, props.workspace.id, props.onKeyboardNavigate),
          }}
          buttonClass="justify-between gap-2"
        >
          <CurrentWorkspaceButtonLeading workspace={props.workspace} state={state} connectingTitle={connectingTitle} />
          <span class="flex shrink-0 items-center gap-1.5">
            <TerminalBellBadge count={terminalBellCount} />
            <ChevronDown size={13} class="shrink-0 text-muted-foreground/70" aria-hidden="true" />
          </span>
        </ToolbarClosableTab>
      )
    }
  },
})

export const CurrentWorkspaceSidebarButton = defineComponent<CurrentWorkspaceSidebarButtonProps>({
  name: 'CurrentWorkspaceSidebarButton',
  inheritAttrs: false,
  props: ['workspace', 'focusRegistry', 'onKeyboardNavigate', 'unavailableLabel', 'terminalBellCount', 'fill'],

  setup(props, { attrs }) {
    const t = useT()
    const { forwardRef } = useForwardExpose()

    return () => {
      const terminalBellCount = props.terminalBellCount ?? 0
      const unreadBellLabel =
        terminalBellCount > 0 ? t('terminal.bell-unread-count', { count: terminalBellCount }) : null
      const state = currentWorkspaceButtonState(props.workspace, props.unavailableLabel, unreadBellLabel)
      const connectingTitle = t('workspace-picker.connecting-title')
      const registryRef = props.focusRegistry?.setRef(props.workspace.id)
      const buttonRef: VNodeRef = (value) => {
        forwardRef(value)
        registryRef?.(value instanceof HTMLButtonElement ? value : null)
      }
      const inheritedProps = mergeProps(attrs, {
        onKeydown: (event: KeyboardEvent) => {
          if (!event.defaultPrevented) {
            handleWorkspaceKeyboardNavigation(event, props.workspace.id, props.onKeyboardNavigate)
          }
        },
      })

      return (
        <SidebarRowButton
          {...inheritedProps}
          ref={buttonRef}
          data-current-workspace-chrome=""
          data-current-workspace-id={props.workspace.id}
          data-current-workspace-connecting={state.showConnecting ? 'true' : undefined}
          size="dense"
          aria-label={state.workspaceLabel}
          fill={props.fill}
          leading={<CurrentWorkspaceButtonIcon workspace={props.workspace} size={16} />}
          trailing={
            <span class="flex items-center gap-1.5">
              <TerminalBellBadge count={terminalBellCount} />
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          }
          contentClass="flex min-w-0 flex-1 items-center gap-2"
        >
          <CurrentWorkspaceButtonText workspace={props.workspace} state={state} connectingTitle={connectingTitle} />
        </SidebarRowButton>
      )
    }
  },
})

interface CurrentWorkspaceButtonState {
  showConnecting: boolean
  showFailed: boolean
  workspaceLabel: string
}

function currentWorkspaceButtonState(
  workspace: WorkspacePickerItem,
  unavailableLabel: string,
  unreadBellLabel: string | null = null,
): CurrentWorkspaceButtonState {
  const showConnecting = workspace.lifecycle?.kind === 'connecting'
  const showFailed = workspace.lifecycle?.kind === 'failed'
  const baseLabel = showFailed ? `${workspace.name} — ${unavailableLabel}` : workspace.name
  return {
    showConnecting,
    showFailed,
    workspaceLabel: unreadBellLabel ? `${baseLabel} — ${unreadBellLabel}` : baseLabel,
  }
}

interface CurrentWorkspaceButtonContentProps {
  workspace: WorkspacePickerItem
  state: CurrentWorkspaceButtonState
  connectingTitle: string
}

const CurrentWorkspaceButtonLeading: FunctionalComponent<CurrentWorkspaceButtonContentProps> = (props) => (
  <span class="flex min-w-0 items-center gap-2">
    <span class={CURRENT_WORKSPACE_ICON_CLASS}>
      <CurrentWorkspaceButtonIcon workspace={props.workspace} size={14} />
    </span>
    <CurrentWorkspaceButtonText
      workspace={props.workspace}
      state={props.state}
      connectingTitle={props.connectingTitle}
    />
  </span>
)

CurrentWorkspaceButtonLeading.props = ['workspace', 'state', 'connectingTitle']

const CurrentWorkspaceButtonIcon: FunctionalComponent<{ workspace: WorkspacePickerItem; size: number }> = (props) => {
  const WorkspaceIcon = isRemoteWorkspaceId(props.workspace.id)
    ? Server
    : props.workspace.gitCapability === 'available'
      ? FolderGit2
      : Folder
  return <WorkspaceIcon size={props.size} class="text-foreground" aria-hidden="true" />
}

CurrentWorkspaceButtonIcon.props = ['workspace', 'size']

const CurrentWorkspaceButtonText: FunctionalComponent<CurrentWorkspaceButtonContentProps> = (props) => (
  <>
    <span class="truncate uppercase">{props.workspace.name}</span>
    {props.state.showConnecting ? (
      <span class="shrink-0 text-muted-foreground" aria-label={props.connectingTitle} title={props.connectingTitle}>
        <Loader2 size={12} class="animate-spin" aria-hidden="true" />
      </span>
    ) : null}
    {props.state.showFailed ? <AlertCircle size={12} class="shrink-0 text-warning" aria-hidden="true" /> : null}
  </>
)

CurrentWorkspaceButtonText.props = ['workspace', 'state', 'connectingTitle']

function handleWorkspaceKeyboardNavigation(
  event: KeyboardEvent,
  workspaceId: WorkspaceId,
  onKeyboardNavigate: CurrentWorkspaceButtonBaseProps['onKeyboardNavigate'],
): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  onKeyboardNavigate(
    workspaceId,
    event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : event.key === 'Home' ? 'first' : 'last',
  )
}
