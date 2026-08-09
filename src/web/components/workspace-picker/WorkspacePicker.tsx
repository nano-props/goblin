import { ChevronDown, Download, Folder, FolderGit2, FolderOpen, Plus, Server, X } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import { isRemoteWorkspaceId, remoteWorkspaceConnectionTarget } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { ToolbarTabList, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { MenuRowButton } from '#/web/components/ui/menu-row-button.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import {
  CurrentWorkspaceSidebarButton,
  CurrentWorkspaceToolbarButton,
} from '#/web/components/workspace-picker/CurrentWorkspaceButton.tsx'
import type {
  WorkspacePickerItem,
  WorkspacePickerLabels,
  WorkspacePickerSurface,
} from '#/web/components/workspace-picker/types.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'

function navigatedWorkspaceId(
  workspaces: WorkspacePickerItem[],
  currentId: WorkspaceId,
  direction: 'prev' | 'next' | 'first' | 'last',
): WorkspaceId | null {
  if (workspaces.length === 0) return null
  const current = workspaces.findIndex((workspace) => workspace.id === currentId)
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? workspaces.length - 1
        : current === -1
          ? 0
          : direction === 'next'
            ? (current + 1) % workspaces.length
            : (current - 1 + workspaces.length) % workspaces.length
  return workspaces[index]?.id ?? null
}

interface WorkspacePickerProps {
  workspaces: WorkspacePickerItem[]
  currentWorkspaceId: WorkspaceId | null
  labels: WorkspacePickerLabels
  onActivate: (id: WorkspaceId) => void
  onClose: (id: WorkspaceId) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
  surface?: WorkspacePickerSurface
}

interface WorkspaceSwitcherActionProps {
  icon: VNodeChild
  label: string
  shortcut: string | null
  onSelect: () => void
}

const WorkspaceSwitcherAction: FunctionalComponent<WorkspaceSwitcherActionProps> = (props) => (
  <MenuRowButton
    leading={props.icon}
    trailing={
      props.shortcut ? (
        <span class="min-w-6 pl-8 text-right text-xs tracking-widest text-muted-foreground">{props.shortcut}</span>
      ) : null
    }
    onClick={props.onSelect}
  >
    {props.label}
  </MenuRowButton>
)

WorkspaceSwitcherAction.props = ['icon', 'label', 'shortcut', 'onSelect']

interface WorkspaceMenuContentProps extends Omit<WorkspacePickerProps, 'surface' | 'onActivate'> {
  onSelectWorkspace: (id: WorkspaceId) => void
  onSelectAction: (action: () => void) => void
}

const WorkspaceMenuContent = defineComponent<WorkspaceMenuContentProps>({
  name: 'WorkspaceMenuContent',
  props: [
    'workspaces',
    'currentWorkspaceId',
    'labels',
    'onClose',
    'onOpenLocal',
    'onOpenRemote',
    'onClone',
    'onSelectWorkspace',
    'onSelectAction',
  ],

  setup(props) {
    return () => {
      const showWorkspaceList = props.workspaces.length > 0
      return (
        <PopoverContent
          side="bottom"
          align="start"
          class="flex w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
          style={{ minWidth: 'max(16rem, var(--reka-popover-trigger-width))' }}
          aria-label={props.labels.workspaces}
          tabindex={-1}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
        >
          {showWorkspaceList ? (
            <ScrollArea class="max-h-80" scrollbarMode="compact">
              <div class="space-y-0.5 p-1" role="list">
                {props.workspaces.map((workspace) => {
                  const selected = workspace.id === props.currentWorkspaceId
                  const WorkspaceIcon = isRemoteWorkspaceId(workspace.id)
                    ? Server
                    : workspace.gitCapability === 'available'
                      ? FolderGit2
                      : Folder
                  const remoteTarget = remoteWorkspaceConnectionTarget(workspace.lifecycle)
                  return (
                    <div key={workspace.id} class="group relative flex items-center" role="listitem">
                      <MenuRowButton
                        size="roomy"
                        selected={selected}
                        onClick={() => props.onSelectWorkspace(workspace.id)}
                        aria-current={selected ? 'true' : undefined}
                        leading={<WorkspaceIcon size={13} class="text-muted-foreground" aria-hidden="true" />}
                        contentClass="whitespace-normal"
                        trailing={
                          (workspace.terminalBellCount ?? 0) > 0 ? (
                            <TerminalBellBadge count={workspace.terminalBellCount ?? 0} />
                          ) : null
                        }
                      >
                        <div class="truncate font-medium leading-5">{workspace.name}</div>
                        <div class="truncate font-mono text-xs leading-4 text-muted-foreground">
                          {formatWorkspaceDisplayLocation(workspace.id, remoteTarget)}
                        </div>
                      </MenuRowButton>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        class="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                        onPointerdown={(event: PointerEvent) => event.stopPropagation()}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation()
                          props.onClose(workspace.id)
                        }}
                        title={props.labels.closeWithName(workspace.name)}
                        aria-label={props.labels.closeWithName(workspace.name)}
                      >
                        <X size={13} />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          ) : null}
          <div class={showWorkspaceList ? 'border-t border-separator p-1' : 'p-1'}>
            <WorkspaceSwitcherAction
              icon={<FolderOpen size={14} />}
              label={props.labels.openLocal}
              shortcut={props.labels.openLocalShortcut}
              onSelect={() => props.onSelectAction(props.onOpenLocal)}
            />
            <WorkspaceSwitcherAction
              icon={<Server size={14} />}
              label={props.labels.openRemote}
              shortcut={props.labels.openRemoteShortcut}
              onSelect={() => props.onSelectAction(props.onOpenRemote)}
            />
            <WorkspaceSwitcherAction
              icon={<Download size={14} />}
              label={props.labels.clone}
              shortcut={props.labels.cloneShortcut}
              onSelect={() => props.onSelectAction(props.onClone)}
            />
          </div>
        </PopoverContent>
      )
    }
  },
})

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
    'surface',
  ],

  setup(props) {
    const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()
    const menuOpen = ref(false)

    function closeWorkspace(id: WorkspaceId): void {
      const isCurrent = id === props.currentWorkspaceId
      const index = props.workspaces.findIndex((workspace) => workspace.id === id)
      const nextId = props.workspaces[index + 1]?.id ?? props.workspaces[index - 1]?.id ?? null
      props.onClose(id)
      if (isCurrent && nextId) focusRegistry.focus(nextId)
    }

    function navigateWorkspace(id: WorkspaceId, direction: 'prev' | 'next' | 'first' | 'last'): void {
      const nextId = navigatedWorkspaceId(props.workspaces, id, direction)
      if (!nextId) return
      props.onActivate(nextId)
      focusRegistry.focus(nextId)
    }

    function selectAction(action: () => void): void {
      menuOpen.value = false
      action()
    }

    return () => {
      const currentWorkspace =
        props.workspaces.find((workspace) => workspace.id === props.currentWorkspaceId) ?? props.workspaces[0] ?? null
      const totalTerminalBellCount = props.workspaces.reduce(
        (count, workspace) => count + (workspace.terminalBellCount ?? 0),
        0,
      )
      const surface = props.surface ?? 'toolbar'

      return (
        <nav class="flex h-full min-w-0 flex-1 items-center" aria-label={props.labels.workspaces}>
          <Popover
            open={menuOpen.value}
            onOpenChange={(open) => {
              menuOpen.value = open
            }}
          >
            {currentWorkspace ? (
              surface === 'sidebar' ? (
                <PopoverTrigger asChild>
                  <CurrentWorkspaceSidebarButton
                    workspace={currentWorkspace}
                    focusRegistry={focusRegistry}
                    onKeyboardNavigate={navigateWorkspace}
                    unavailableLabel={props.labels.unavailable}
                    terminalBellCount={totalTerminalBellCount}
                    fill
                  />
                </PopoverTrigger>
              ) : (
                <PopoverTrigger asChild>
                  <ToolbarTabStripBody class="flex-1">
                    <ToolbarTabList
                      role="tablist"
                      aria-orientation="horizontal"
                      data-current-workspace-group=""
                      class="flex-1"
                    >
                      <CurrentWorkspaceToolbarButton
                        workspace={currentWorkspace}
                        isCurrent={currentWorkspace.id === props.currentWorkspaceId}
                        focusRegistry={focusRegistry}
                        onActivate={props.onActivate}
                        onKeyboardNavigate={navigateWorkspace}
                        unavailableLabel={props.labels.unavailable}
                        terminalBellCount={totalTerminalBellCount}
                        fill
                      />
                    </ToolbarTabList>
                  </ToolbarTabStripBody>
                </PopoverTrigger>
              )
            ) : surface === 'sidebar' ? (
              <PopoverTrigger asChild>
                <SidebarRowButton
                  data-testid="workspace-picker-placeholder"
                  aria-label={props.labels.placeholder}
                  size="dense"
                  fill
                  leading={<FolderOpen size={16} />}
                  trailing={<ChevronDown size={14} aria-hidden="true" />}
                >
                  {props.labels.placeholder}
                </SidebarRowButton>
              </PopoverTrigger>
            ) : (
              <Tip label={props.labels.open}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label={props.labels.open}>
                    <Plus />
                  </Button>
                </PopoverTrigger>
              </Tip>
            )}
            <WorkspaceMenuContent
              workspaces={props.workspaces}
              currentWorkspaceId={props.currentWorkspaceId}
              labels={props.labels}
              onSelectWorkspace={(id) => {
                menuOpen.value = false
                props.onActivate(id)
              }}
              onClose={(id) => {
                menuOpen.value = false
                closeWorkspace(id)
              }}
              onOpenLocal={props.onOpenLocal}
              onOpenRemote={props.onOpenRemote}
              onClone={props.onClone}
              onSelectAction={selectAction}
            />
          </Popover>
        </nav>
      )
    }
  },
})
