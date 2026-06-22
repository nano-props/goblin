import { type ReactNode, useCallback, useRef, useState } from 'react'
import { Check, Download, FolderGit2, FolderOpen, Plus, Server, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { ToolbarTabList, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { CurrentRepoButton } from '#/web/components/repo-picker/CurrentRepoButton.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { RepoPickerLabels, RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import { isRemoteRepoId, remoteRepoLifecycleTarget } from '#/shared/remote-repo.ts'
import { formatRepoLocator } from '#/web/lib/paths.ts'

function navigatedRepoId(
  repos: RepoPickerRepo[],
  currentId: string,
  direction: 'prev' | 'next' | 'first' | 'last',
): string | null {
  if (repos.length === 0) return null
  const current = repos.findIndex((repo) => repo.id === currentId)
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? repos.length - 1
        : current === -1
          ? 0
          : direction === 'next'
            ? (current + 1) % repos.length
            : (current - 1 + repos.length) % repos.length
  return repos[index]?.id ?? null
}

interface RepoPickerProps {
  repos: RepoPickerRepo[]
  activeId: string | null
  labels: RepoPickerLabels
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
}

function RepoSwitcherAction({
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
    <button
      type="button"
      className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-popover-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
      onClick={onSelect}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="ml-auto min-w-6 pl-8 text-right text-xs tracking-widest text-muted-foreground">
          {shortcut}
        </span>
      )}
    </button>
  )
}

function OpenRepoPopover({
  labels,
  onOpenLocal,
  onOpenRemote,
  onClone,
}: Pick<RepoPickerProps, 'labels' | 'onOpenLocal' | 'onOpenRemote' | 'onClone'>) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectAction = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={labels.open}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={labels.open}>
            <Plus />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-max min-w-48 max-w-72 flex-col overflow-hidden p-0"
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
      >
        <div className="flex h-8 items-center border-b border-separator px-2.5">
          <span className="min-w-0 truncate text-xs font-medium text-popover-foreground">{labels.open}</span>
        </div>
        <div className="p-1">
          <RepoSwitcherAction
            icon={<FolderOpen size={14} />}
            label={labels.openLocal}
            shortcut={labels.openLocalShortcut}
            onSelect={() => selectAction(onOpenLocal)}
          />
          <RepoSwitcherAction
            icon={<Server size={14} />}
            label={labels.openRemote}
            shortcut={labels.openRemoteShortcut}
            onSelect={() => selectAction(onOpenRemote)}
          />
          <RepoSwitcherAction
            icon={<Download size={14} />}
            label={labels.clone}
            shortcut={labels.cloneShortcut}
            onSelect={() => selectAction(onClone)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Popover content for the repo menu. The Popover itself is owned by
// `RepoPicker` so the tab strip can be the trigger and the popover
// state can be reset on selection.
//
// Each row is a two-line entry: repo name on top, locator (path or
// remote target) below in mono muted text. Rows grow from h-8 (32px)
// to min-h-11 (44px) to fit both lines comfortably; the close button
// stays absolutely positioned and centred vertically so it stays in
// reach as the row grows.
function RepoMenuContent({
  repos,
  activeId,
  labels,
  onSelectRepo,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
  onSelectAction,
}: {
  repos: RepoPickerRepo[]
  activeId: string | null
  labels: RepoPickerLabels
  onSelectRepo: (id: string) => void
  onClose: (id: string) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
  onSelectAction: (action: () => void) => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <PopoverContent
      side="bottom"
      align="start"
      className="flex w-max min-w-64 max-w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
      aria-label={labels.repositories}
      ref={contentRef}
      tabIndex={-1}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        contentRef.current?.focus({ preventScroll: true })
      }}
    >
      <ScrollArea className="max-h-80" scrollbarMode="compact">
        <div className="space-y-0.5 p-1" role="list">
          {repos.map((repo) => {
            const selected = repo.id === activeId
            const RepoIcon = isRemoteRepoId(repo.id) ? Server : FolderGit2
            const remoteTarget = remoteRepoLifecycleTarget(repo.lifecycle)
            return (
              <div key={repo.id} className="group relative flex items-center" role="listitem">
                <button
                  type="button"
                  className={cn(
                    'flex w-full min-h-11 cursor-pointer items-center gap-2.5 rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
                    selected &&
                      'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground',
                  )}
                  onClick={() => onSelectRepo(repo.id)}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {selected ? (
                      <Check size={13} aria-hidden />
                    ) : (
                      <RepoIcon size={13} className="text-muted-foreground" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <div className="truncate font-medium leading-5">{repo.name}</div>
                    <div className="truncate font-mono text-xs leading-4 text-muted-foreground">
                      {formatRepoLocator(repo.id, remoteTarget)}
                    </div>
                  </span>
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(repo.id)
                  }}
                  title={labels.closeWithName(repo.name)}
                  aria-label={labels.closeWithName(repo.name)}
                >
                  <X size={13} />
                </Button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <div className="border-t border-separator p-1">
        <RepoSwitcherAction
          icon={<FolderOpen size={14} />}
          label={labels.openLocal}
          shortcut={labels.openLocalShortcut}
          onSelect={() => onSelectAction(onOpenLocal)}
        />
        <RepoSwitcherAction
          icon={<Server size={14} />}
          label={labels.openRemote}
          shortcut={labels.openRemoteShortcut}
          onSelect={() => onSelectAction(onOpenRemote)}
        />
        <RepoSwitcherAction
          icon={<Download size={14} />}
          label={labels.clone}
          shortcut={labels.cloneShortcut}
          onSelect={() => onSelectAction(onClone)}
        />
      </div>
    </PopoverContent>
  )
}

export function RepoPicker({
  repos,
  activeId,
  labels,
  onActivate,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
}: RepoPickerProps) {
  const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleClose = useCallback(
    (id: string) => {
      const isActive = id === activeId
      const idx = repos.findIndex((r) => r.id === id)
      const nextId = repos[idx + 1]?.id ?? repos[idx - 1]?.id ?? null
      onClose(id)
      if (isActive && nextId) {
        focusRegistry.focus(nextId)
      }
    },
    [repos, activeId, onClose, focusRegistry],
  )

  const handleKeyboardNavigate = (id: string, direction: 'prev' | 'next' | 'first' | 'last') => {
    const nextId = navigatedRepoId(repos, id, direction)
    if (!nextId) return
    onActivate(nextId)
    focusRegistry.focus(nextId)
  }

  const currentRepo = repos.find((r) => r.id === activeId) ?? repos[0] ?? null

  const openMenu = (
    <OpenRepoPopover labels={labels} onOpenLocal={onOpenLocal} onOpenRemote={onOpenRemote} onClone={onClone} />
  )

  return (
    <nav className="flex h-full min-w-0 items-center" aria-label={labels.repositories}>
      {!currentRepo ? (
        openMenu
      ) : (
        <ToolbarTabStripBody>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              {/* The tablist absorbs PopoverTrigger's onClick + data
               * attributes; clicks anywhere in the tab area open the
               * popover. The inner CurrentRepoButton keeps its focus
               * and keyboard nav (ArrowLeft/Right) for repository
               * switching without opening the popover. */}
              <ToolbarTabList role="tablist" aria-orientation="horizontal" data-current-repo-group>
                <CurrentRepoButton
                  repo={currentRepo}
                  isCurrent={currentRepo.id === activeId}
                  focusRegistry={focusRegistry}
                  onActivate={onActivate}
                  onKeyboardNavigate={handleKeyboardNavigate}
                  unavailableLabel={labels.unavailable}
                />
              </ToolbarTabList>
            </PopoverTrigger>
            <RepoMenuContent
              repos={repos}
              activeId={activeId}
              labels={labels}
              onSelectRepo={(id) => {
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
        </ToolbarTabStripBody>
      )}
    </nav>
  )
}
