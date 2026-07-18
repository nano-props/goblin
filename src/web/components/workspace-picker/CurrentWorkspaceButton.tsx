import type { ComponentProps, KeyboardEvent } from 'react'
import { AlertCircle, ChevronDown, Folder, FolderGit2, Loader2, Server } from 'lucide-react'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { toolbarTabChromeClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { useT } from '#/web/stores/i18n.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { cn } from '#/web/lib/cn.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { composeRefs } from '#/web/components/ui/refs.ts'

const CURRENT_WORKSPACE_ICON_CLASS = 'flex size-3.5 shrink-0 items-center justify-center'

interface CurrentWorkspaceButtonBaseProps {
  workspace: WorkspacePickerItem
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  unavailableLabel: string
  terminalBellCount?: number
  fill?: boolean
}

interface CurrentWorkspaceToolbarButtonProps extends CurrentWorkspaceButtonBaseProps {
  isCurrent: boolean
  onActivate: (id: string) => void
}

type CurrentWorkspaceSidebarButtonProps = Omit<ComponentProps<'button'>, 'children' | 'type'> & CurrentWorkspaceButtonBaseProps

export function CurrentWorkspaceToolbarButton({
  workspace,
  isCurrent,
  focusRegistry,
  onActivate,
  onKeyboardNavigate,
  unavailableLabel,
  terminalBellCount = 0,
  fill = false,
}: CurrentWorkspaceToolbarButtonProps) {
  const t = useT()
  const unreadBellLabel = terminalBellCount > 0 ? t('terminal.bell-unread-count', { count: terminalBellCount }) : null
  const state = currentWorkspaceButtonState(workspace, unavailableLabel, unreadBellLabel)

  return (
    <ToolbarClosableTab
      containerProps={{
        'data-interactive': true,
        'data-current-workspace-chrome': true,
      }}
      containerClassName={cn(
        toolbarTabChromeClassName({
          variant: 'workspace-picker',
          active: isCurrent,
          compact: true,
        }),
        fill && 'max-w-none flex-1',
      )}
      buttonRef={focusRegistry?.setRef(workspace.id)}
      buttonProps={{
        'data-current-workspace-id': workspace.id,
        'data-current-workspace-connecting': state.showConnecting ? 'true' : undefined,
        role: 'tab',
        tabIndex: isCurrent ? 0 : -1,
        'aria-selected': isCurrent,
        'aria-label': state.workspaceLabel,
        onClick: () => onActivate(workspace.id),
        onKeyDown: (event) => handleWorkspaceKeyboardNavigation(event, workspace.id, onKeyboardNavigate),
      }}
      closeButton={false}
      // justify-between pushes the chevron to the trailing edge so
      // the tab reads as a dropdown button rather than a label
      // followed by an ornament; the inner span groups the leading
      // icon + name + status indicators so they stay together when
      // the name truncates.
      buttonClassName="justify-between gap-2"
    >
      <CurrentWorkspaceButtonLeading workspace={workspace} state={state} />
      {/* Chevron signals that the tab is a popover trigger; it is
       * always visible (no fade-in affordance) so the discovery
       * signal matches the standard HTML <select> / macOS popup
       * button pattern. Decorative — the button's aria-label already
       * names the workspace, so screen readers don't need the chevron. */}
      <span className="flex shrink-0 items-center gap-1.5">
        <TerminalBellBadge count={terminalBellCount} />
        <ChevronDown size={13} className="shrink-0 text-muted-foreground/70" aria-hidden />
      </span>
    </ToolbarClosableTab>
  )
}

export function CurrentWorkspaceSidebarButton({
  workspace,
  focusRegistry,
  onKeyboardNavigate,
  unavailableLabel,
  terminalBellCount = 0,
  fill = false,
  className,
  onKeyDown,
  ref,
  ...buttonProps
}: CurrentWorkspaceSidebarButtonProps) {
  const t = useT()
  const unreadBellLabel = terminalBellCount > 0 ? t('terminal.bell-unread-count', { count: terminalBellCount }) : null
  const state = currentWorkspaceButtonState(workspace, unavailableLabel, unreadBellLabel)
  const registryRef = focusRegistry?.setRef(workspace.id)

  return (
    <SidebarRowButton
      {...buttonProps}
      ref={composeRefs(registryRef, ref)}
      data-current-workspace-chrome
      data-current-workspace-id={workspace.id}
      data-current-workspace-connecting={state.showConnecting ? 'true' : undefined}
      className={className}
      size="dense"
      aria-label={state.workspaceLabel}
      fill={fill}
      leading={<CurrentWorkspaceButtonIcon workspace={workspace} size={16} />}
      trailing={
        <span className="flex items-center gap-1.5">
          <TerminalBellBadge count={terminalBellCount} />
          <ChevronDown size={14} aria-hidden />
        </span>
      }
      contentClassName="flex min-w-0 flex-1 items-center gap-2"
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) handleWorkspaceKeyboardNavigation(event, workspace.id, onKeyboardNavigate)
      }}
    >
      <CurrentWorkspaceButtonText workspace={workspace} state={state} />
    </SidebarRowButton>
  )
}

function currentWorkspaceButtonState(workspace: WorkspacePickerItem, unavailableLabel: string, unreadBellLabel: string | null = null) {
  const showConnecting = workspace.lifecycle?.kind === 'connecting'
  const showFailed = workspace.lifecycle?.kind === 'failed'
  const baseLabel = showFailed ? `${workspace.name} — ${unavailableLabel}` : workspace.name
  return {
    showConnecting,
    showFailed,
    workspaceLabel: unreadBellLabel ? `${baseLabel} — ${unreadBellLabel}` : baseLabel,
  }
}

function CurrentWorkspaceButtonLeading({
  workspace,
  state,
}: {
  workspace: WorkspacePickerItem
  state: ReturnType<typeof currentWorkspaceButtonState>
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={CURRENT_WORKSPACE_ICON_CLASS}>
        <CurrentWorkspaceButtonIcon workspace={workspace} size={14} />
      </span>
      <CurrentWorkspaceButtonText workspace={workspace} state={state} />
    </span>
  )
}

function CurrentWorkspaceButtonIcon({ workspace, size }: { workspace: WorkspacePickerItem; size: number }) {
  const WorkspaceIcon =
    isRemoteRepoId(workspace.id) ? Server : workspace.gitCapability === 'available' ? FolderGit2 : Folder
  return <WorkspaceIcon size={size} className="text-foreground" aria-hidden />
}

function CurrentWorkspaceButtonText({
  workspace,
  state,
}: {
  workspace: WorkspacePickerItem
  state: ReturnType<typeof currentWorkspaceButtonState>
}) {
  const t = useT()
  const connectingTitle = t('workspace-picker.connecting-title')
  return (
    <>
      <span className="truncate uppercase">{workspace.name}</span>
      {state.showConnecting && (
        <span className="shrink-0 text-muted-foreground" aria-label={connectingTitle} title={connectingTitle}>
          <Loader2 size={12} className="animate-spin" aria-hidden />
        </span>
      )}
      {state.showFailed && <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden />}
    </>
  )
}

function handleWorkspaceKeyboardNavigation(
  event: KeyboardEvent<HTMLButtonElement>,
  workspaceId: string,
  onKeyboardNavigate: CurrentWorkspaceButtonBaseProps['onKeyboardNavigate'],
) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  onKeyboardNavigate(
    workspaceId,
    event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : event.key === 'Home' ? 'first' : 'last',
  )
}
