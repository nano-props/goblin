import { type ReactNode, useCallback, useRef, useState } from 'react'
import { Check, ChevronDown, Download, FolderGit2, FolderOpen, Plus, Server, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { ToolbarTabList, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { MenuRowButton } from '#/web/components/ui/menu-row-button.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { CurrentRepoSidebarButton, CurrentRepoToolbarButton } from '#/web/components/repo-picker/CurrentRepoButton.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { RepoPickerLabels, RepoPickerRepo, RepoPickerSurface } from '#/web/components/repo-picker/types.ts'
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
  surface?: RepoPickerSurface
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
  const showRepoList = repos.length > 0
  return (
    <PopoverContent
      side="bottom"
      align="start"
      className="flex w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
      style={{ minWidth: 'max(16rem, var(--radix-popover-trigger-width))' }}
      aria-label={labels.repositories}
      ref={contentRef}
      tabIndex={-1}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        contentRef.current?.focus({ preventScroll: true })
      }}
    >
      {showRepoList ? (
        <>
          <ScrollArea className="max-h-80" scrollbarMode="compact">
            <div className="space-y-0.5 p-1" role="list">
              {repos.map((repo) => {
                const selected = repo.id === activeId
                const RepoIcon = isRemoteRepoId(repo.id) ? Server : FolderGit2
                const remoteTarget = remoteRepoLifecycleTarget(repo.lifecycle)
                return (
                  <div key={repo.id} className="group relative flex items-center" role="listitem">
                    <MenuRowButton
                      size="roomy"
                      selected={selected}
                      onClick={() => onSelectRepo(repo.id)}
                      aria-current={selected ? 'true' : undefined}
                      leading={
                        selected ? (
                          <Check size={13} aria-hidden />
                        ) : (
                          <RepoIcon size={13} className="text-muted-foreground" aria-hidden />
                        )
                      }
                      contentClassName="whitespace-normal"
                    >
                      <div className="truncate font-medium leading-5">{repo.name}</div>
                      <div className="truncate font-mono text-xs leading-4 text-muted-foreground">
                        {formatRepoLocator(repo.id, remoteTarget)}
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
        </>
      ) : (
        <div className="p-1">
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
      )}
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
  surface = 'toolbar',
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

  return (
    <nav className="flex h-full min-w-0 flex-1 items-center" aria-label={labels.repositories}>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        {currentRepo ? (
          surface === 'sidebar' ? (
            <PopoverTrigger asChild>
              <CurrentRepoSidebarButton
                repo={currentRepo}
                focusRegistry={focusRegistry}
                onKeyboardNavigate={handleKeyboardNavigate}
                unavailableLabel={labels.unavailable}
                fill
              />
            </PopoverTrigger>
          ) : (
            <PopoverTrigger asChild>
              <ToolbarTabStripBody className="flex-1">
                <ToolbarTabList role="tablist" aria-orientation="horizontal" data-current-repo-group className="flex-1">
                  <CurrentRepoToolbarButton
                    repo={currentRepo}
                    isCurrent={currentRepo.id === activeId}
                    focusRegistry={focusRegistry}
                    onActivate={onActivate}
                    onKeyboardNavigate={handleKeyboardNavigate}
                    unavailableLabel={labels.unavailable}
                    fill
                  />
                </ToolbarTabList>
              </ToolbarTabStripBody>
            </PopoverTrigger>
          )
        ) : surface === 'sidebar' ? (
          <PopoverTrigger asChild>
            <SidebarRowButton
              data-testid="repo-picker-placeholder"
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
    </nav>
  )
}
