import { type ReactNode, useCallback, useRef, useState } from 'react'
import { Check, ChevronDown, Download, Folder, FolderGit2, FolderOpen, Plus, Server, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { ToolbarTabList, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { MenuRowButton } from '#/web/components/ui/menu-row-button.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import {
  CurrentWorkspaceSidebarButton,
  CurrentWorkspaceToolbarButton,
} from '#/web/components/workspace-picker/CurrentWorkspaceButton.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type {
  WorkspacePickerLabels,
  WorkspacePickerItem,
  WorkspacePickerSurface,
} from '#/web/components/workspace-picker/types.ts'
import { isRemoteWorkspaceId, remoteWorkspaceConnectionTarget } from '#/shared/remote-workspace.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

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

function WorkspaceSwitcherAction({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: ReactNode
  label: string
  shortcut: string | null
  onSelect: () => void
}) {
  return (
    <MenuRowButton
      leading={icon}
      trailing={
        shortcut ? (
          <span className="min-w-6 pl-8 text-right text-xs tracking-widest text-muted-foreground">{shortcut}</span>
        ) : null
      }
      onClick={onSelect}
    >
      {label}
    </MenuRowButton>
  )
}

function WorkspaceMenuContent({
  workspaces,
  currentWorkspaceId,
  labels,
  onSelectWorkspace,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
  onSelectAction,
}: {
  workspaces: WorkspacePickerItem[]
  currentWorkspaceId: WorkspaceId | null
  labels: WorkspacePickerLabels
  onSelectWorkspace: (id: WorkspaceId) => void
  onClose: (id: WorkspaceId) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
  onSelectAction: (action: () => void) => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const showWorkspaceList = workspaces.length > 0
  return (
    <PopoverContent
      side="bottom"
      align="start"
      className="flex w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
      style={{ minWidth: 'max(16rem, var(--radix-popover-trigger-width))' }}
      aria-label={labels.workspaces}
      ref={contentRef}
      tabIndex={-1}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        contentRef.current?.focus({ preventScroll: true })
      }}
    >
      {showWorkspaceList ? (
        <>
          <ScrollArea className="max-h-80" scrollbarMode="compact">
            <div className="space-y-0.5 p-1" role="list">
              {workspaces.map((workspace) => {
                const selected = workspace.id === currentWorkspaceId
                const WorkspaceIcon = isRemoteWorkspaceId(workspace.id)
                  ? Server
                  : workspace.gitCapability === 'available'
                    ? FolderGit2
                    : Folder
                const remoteTarget = remoteWorkspaceConnectionTarget(workspace.lifecycle)
                return (
                  <div key={workspace.id} className="group relative flex items-center" role="listitem">
                    <MenuRowButton
                      size="roomy"
                      selected={selected}
                      onClick={() => onSelectWorkspace(workspace.id)}
                      aria-current={selected ? 'true' : undefined}
                      leading={<WorkspaceIcon size={13} className="text-muted-foreground" aria-hidden />}
                      contentClassName="whitespace-normal"
                      trailing={
                        selected || (workspace.terminalBellCount ?? 0) > 0 ? (
                          <div className="flex items-center gap-1.5">
                            {(workspace.terminalBellCount ?? 0) > 0 ? (
                              <TerminalBellBadge count={workspace.terminalBellCount ?? 0} />
                            ) : null}
                            {selected ? <Check size={13} aria-hidden /> : null}
                          </div>
                        ) : null
                      }
                    >
                      <div className="truncate font-medium leading-5">{workspace.name}</div>
                      <div className="truncate font-mono text-xs leading-4 text-muted-foreground">
                        {formatWorkspaceDisplayLocation(workspace.id, remoteTarget)}
                      </div>
                    </MenuRowButton>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(workspace.id)
                      }}
                      title={labels.closeWithName(workspace.name)}
                      aria-label={labels.closeWithName(workspace.name)}
                    >
                      <X size={13} />
                    </Button>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          <div className="border-t border-separator p-1">
            <WorkspaceSwitcherAction
              icon={<FolderOpen size={14} />}
              label={labels.openLocal}
              shortcut={labels.openLocalShortcut}
              onSelect={() => onSelectAction(onOpenLocal)}
            />
            <WorkspaceSwitcherAction
              icon={<Server size={14} />}
              label={labels.openRemote}
              shortcut={labels.openRemoteShortcut}
              onSelect={() => onSelectAction(onOpenRemote)}
            />
            <WorkspaceSwitcherAction
              icon={<Download size={14} />}
              label={labels.clone}
              shortcut={labels.cloneShortcut}
              onSelect={() => onSelectAction(onClone)}
            />
          </div>
        </>
      ) : (
        <div className="p-1">
          <WorkspaceSwitcherAction
            icon={<FolderOpen size={14} />}
            label={labels.openLocal}
            shortcut={labels.openLocalShortcut}
            onSelect={() => onSelectAction(onOpenLocal)}
          />
          <WorkspaceSwitcherAction
            icon={<Server size={14} />}
            label={labels.openRemote}
            shortcut={labels.openRemoteShortcut}
            onSelect={() => onSelectAction(onOpenRemote)}
          />
          <WorkspaceSwitcherAction
            icon={<Download size={14} />}
            label={labels.clone}
            shortcut={labels.cloneShortcut}
            onSelect={() => onSelectAction(onClone)}
          />
        </div>
      )}
    </PopoverContent>
  )
}

export function WorkspacePicker({
  workspaces,
  currentWorkspaceId,
  labels,
  onActivate,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
  surface = 'toolbar',
}: WorkspacePickerProps) {
  const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleClose = useCallback(
    (id: WorkspaceId) => {
      const isCurrent = id === currentWorkspaceId
      const idx = workspaces.findIndex((r) => r.id === id)
      const nextId = workspaces[idx + 1]?.id ?? workspaces[idx - 1]?.id ?? null
      onClose(id)
      if (isCurrent && nextId) {
        focusRegistry.focus(nextId)
      }
    },
    [workspaces, currentWorkspaceId, onClose, focusRegistry],
  )

  const handleKeyboardNavigate = (id: WorkspaceId, direction: 'prev' | 'next' | 'first' | 'last') => {
    const nextId = navigatedWorkspaceId(workspaces, id, direction)
    if (!nextId) return
    onActivate(nextId)
    focusRegistry.focus(nextId)
  }

  const currentWorkspace = workspaces.find((r) => r.id === currentWorkspaceId) ?? workspaces[0] ?? null
  const totalTerminalBellCount = workspaces.reduce((count, workspace) => count + (workspace.terminalBellCount ?? 0), 0)

  return (
    <nav className="flex h-full min-w-0 flex-1 items-center" aria-label={labels.workspaces}>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        {currentWorkspace ? (
          surface === 'sidebar' ? (
            <PopoverTrigger asChild>
              <CurrentWorkspaceSidebarButton
                workspace={currentWorkspace}
                focusRegistry={focusRegistry}
                onKeyboardNavigate={handleKeyboardNavigate}
                unavailableLabel={labels.unavailable}
                terminalBellCount={totalTerminalBellCount}
                fill
              />
            </PopoverTrigger>
          ) : (
            <PopoverTrigger asChild>
              <ToolbarTabStripBody className="flex-1">
                <ToolbarTabList
                  role="tablist"
                  aria-orientation="horizontal"
                  data-current-workspace-group
                  className="flex-1"
                >
                  <CurrentWorkspaceToolbarButton
                    workspace={currentWorkspace}
                    isCurrent={currentWorkspace.id === currentWorkspaceId}
                    focusRegistry={focusRegistry}
                    onActivate={onActivate}
                    onKeyboardNavigate={handleKeyboardNavigate}
                    unavailableLabel={labels.unavailable}
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
              aria-label={labels.placeholder}
              size="dense"
              fill
              leading={<FolderOpen size={16} />}
              trailing={<ChevronDown size={14} aria-hidden />}
            >
              {labels.placeholder}
            </SidebarRowButton>
          </PopoverTrigger>
        ) : (
          <Tip label={labels.open}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={labels.open}>
                <Plus />
              </Button>
            </PopoverTrigger>
          </Tip>
        )}
        <WorkspaceMenuContent
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          labels={labels}
          onSelectWorkspace={(id) => {
            setMenuOpen(false)
            onActivate(id)
          }}
          onClose={(id) => {
            setMenuOpen(false)
            handleClose(id)
          }}
          onOpenLocal={onOpenLocal}
          onOpenRemote={onOpenRemote}
          onClone={onClone}
          onSelectAction={(action) => {
            setMenuOpen(false)
            action()
          }}
        />
      </Popover>
    </nav>
  )
}
