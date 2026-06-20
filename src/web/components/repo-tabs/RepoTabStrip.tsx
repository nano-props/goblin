import { type ReactNode, useCallback, useRef, useState } from 'react'
import { Check, ChevronDown, Download, FolderGit2, FolderOpen, Plus, Server, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { RepoTab } from '#/web/components/repo-tabs/RepoTab.tsx'
import { RepoTabTooltipLayer } from '#/web/components/repo-tabs/RepoTabTooltipLayer.tsx'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { RepoTabStripLabels, RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

function navigatedRepoTabId(
  repos: RepoTabSummary[],
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

interface RepoTabStripProps {
  repos: RepoTabSummary[]
  activeId: string | null
  labels: RepoTabStripLabels
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
}

function RepoTabEdgeAction({ children, showSeparator = false }: { children: ReactNode; showSeparator?: boolean }) {
  return (
    <div className="relative flex h-8 shrink-0 items-center pl-1">
      {showSeparator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 h-4 -translate-y-1/2 border-l border-separator"
        />
      )}
      {children}
    </div>
  )
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
}: Pick<RepoTabStripProps, 'labels' | 'onOpenLocal' | 'onOpenRemote' | 'onClone'>) {
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

function RepoSwitcherPopover({
  repos,
  activeId,
  labels,
  onActivate,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
}: {
  repos: RepoTabSummary[]
  activeId: string | null
  labels: RepoTabStripLabels
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
}) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectRepo = (id: string) => {
    setOpen(false)
    onActivate(id)
  }

  const selectAction = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={labels.more}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={labels.more}>
            <ChevronDown />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-max min-w-48 max-w-72 flex-col overflow-hidden p-0"
        aria-label={labels.repositories}
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
      >
        <ScrollArea className="max-h-64" scrollbarMode="compact">
          <div className="space-y-0.5 p-1" role="list">
            {repos.map((repo) => {
              const selected = repo.id === activeId
              const RepoIcon = isRemoteRepoId(repo.id) ? Server : FolderGit2
              return (
                <div key={repo.id} className="group relative flex items-center" role="listitem">
                  <button
                    type="button"
                    className={cn(
                      'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 pr-8 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
                      selected &&
                        'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground',
                    )}
                    onClick={() => selectRepo(repo.id)}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {selected ? (
                        <Check size={13} aria-hidden />
                      ) : (
                        <RepoIcon size={13} className="text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
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

function CompactRepoTabs({
  visibleRepos,
  allRepos,
  activeId,
  labels,
  onActivate,
  onKeyboardNavigate,
  focusRegistry,
  moreMenu,
}: {
  visibleRepos: RepoTabSummary[]
  allRepos: RepoTabSummary[]
  activeId: string | null
  labels: RepoTabStripLabels
  onActivate: (id: string) => void
  onKeyboardNavigate: (id: string, direction: 'prev' | 'next' | 'first' | 'last') => void
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  moreMenu: ReactNode
}) {
  const showMoreSeparator = visibleRepos.length > 0

  return (
    <ToolbarTabStripBody>
      <RepoTabTooltipLayer repos={allRepos} role="tablist">
        {visibleRepos.map((repo, index) => (
          <RepoTab
            key={repo.id}
            repo={repo}
            isActive={repo.id === activeId}
            index={index}
            total={allRepos.length}
            focusRegistry={focusRegistry}
            onActivate={onActivate}
            onKeyboardNavigate={onKeyboardNavigate}
            unavailableLabel={labels.unavailable}
            compact
          />
        ))}
      </RepoTabTooltipLayer>
      <RepoTabEdgeAction showSeparator={showMoreSeparator}>{moreMenu}</RepoTabEdgeAction>
    </ToolbarTabStripBody>
  )
}

export function RepoTabStrip({
  repos,
  activeId,
  labels,
  onActivate,
  onClose,
  onOpenLocal,
  onOpenRemote,
  onClone,
}: RepoTabStripProps) {
  const focusRegistry = useFocusRegistry<string, HTMLButtonElement>()

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
    const nextId = navigatedRepoTabId(repos, id, direction)
    if (!nextId) return
    onActivate(nextId)
    focusRegistry.focus(nextId)
  }

  const activeRepo = repos.find((r) => r.id === activeId)
  // The repo strip now always renders the compact shape: one visible repo tab
  // plus a switcher popover that contains every open repo and open/clone actions.
  const visibleRepos = activeRepo ? [activeRepo] : repos.slice(0, 1)

  const openMenu = (
    <RepoTabEdgeAction>
      <OpenRepoPopover labels={labels} onOpenLocal={onOpenLocal} onOpenRemote={onOpenRemote} onClone={onClone} />
    </RepoTabEdgeAction>
  )

  return (
    <nav className="flex h-full min-w-0 flex-1 items-center" aria-label={labels.repositories}>
      {repos.length === 0 ? (
        openMenu
      ) : (
        <div className="flex h-full min-w-0 flex-1 items-center">
          <CompactRepoTabs
            visibleRepos={visibleRepos}
            allRepos={repos}
            activeId={activeId}
            labels={labels}
            focusRegistry={focusRegistry}
            onActivate={onActivate}
            onKeyboardNavigate={handleKeyboardNavigate}
            moreMenu={
              <RepoSwitcherPopover
                repos={repos}
                activeId={activeId}
                labels={labels}
                onActivate={onActivate}
                onClose={handleClose}
                onOpenLocal={onOpenLocal}
                onOpenRemote={onOpenRemote}
                onClone={onClone}
              />
            }
          />
        </div>
      )}
    </nav>
  )
}
