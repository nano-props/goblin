import { type ReactNode, useState } from 'react'
import { ChevronDown, Download, FolderOpen, Plus, Server } from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { useIsSmallScreen } from '#/web/hooks/useIsSmallScreen.ts'
import { RepoTab } from '#/web/components/repo-tabs/RepoTab.tsx'
import { RepoTabTooltipLayer } from '#/web/components/repo-tabs/RepoTabTooltipLayer.tsx'
import type { RepoTabStripLabels, RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min, max))
}

const restrictToVisibleTabStrip: Modifier = ({
  activeNodeRect,
  containerNodeRect,
  draggingNodeRect,
  scrollableAncestorRects,
  transform,
  windowRect,
}) => {
  const horizontalTransform = { ...transform, y: 0 }
  const draggableRect = draggingNodeRect ?? activeNodeRect
  const bounds = scrollableAncestorRects[0] ?? containerNodeRect ?? windowRect
  if (!draggableRect || !bounds) return horizontalTransform
  const minX = bounds.left - draggableRect.left
  const maxX = bounds.right - draggableRect.right
  return { ...horizontalTransform, x: clamp(horizontalTransform.x, minX, maxX) }
}

function shouldShowInactiveSeparator({
  leftId,
  rightId,
  activeId,
  hoveredId,
}: {
  leftId: string
  rightId: string | undefined
  activeId: string | null
  hoveredId: string | null
}): boolean {
  return !!rightId && leftId !== activeId && rightId !== activeId && leftId !== hoveredId && rightId !== hoveredId
}

interface RepoTabStripProps {
  repos: RepoTabSummary[]
  activeId: string | null
  labels: RepoTabStripLabels
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (activeId: string, overId: string) => void
  onOpenLocal: () => void
  onOpenRemote: () => void
  onClone: () => void
}

function RepoTabEdgeAction({
  children,
  showSeparator = false,
}: {
  children: ReactNode
  showSeparator?: boolean
}) {
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

export function RepoTabStrip({
  repos,
  activeId,
  labels,
  onActivate,
  onClose,
  onReorder,
  onOpenLocal,
  onOpenRemote,
  onClone,
}: RepoTabStripProps) {
  const isSmallScreen = useIsSmallScreen()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder(String(active.id), String(over.id))
  }

  const focusRepoTab = (id: string) => {
    window.requestAnimationFrame(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-repo-tab-id]')) {
        if (el.dataset.repoTabId === id) {
          el.focus()
          break
        }
      }
    })
  }

  const handleKeyboardNavigate = (id: string, direction: 'prev' | 'next' | 'first' | 'last') => {
    if (repos.length === 0) return
    const current = repos.findIndex((repo) => repo.id === id)
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
    const next = repos[index]
    if (!next) return
    onActivate(next.id)
    focusRepoTab(next.id)
  }

  const ids = repos.map((repo) => repo.id)
  const lastRepo = repos[repos.length - 1]
  const showOpenSeparator = !!lastRepo && lastRepo.id !== activeId && lastRepo.id !== hoveredId

  const activeRepo = repos.find((r) => r.id === activeId)
  const visibleRepos = isSmallScreen ? (activeRepo ? [activeRepo] : repos.slice(0, 1)) : repos
  const visibleIds = new Set(visibleRepos.map((r) => r.id))
  const overflowRepos = isSmallScreen ? repos.filter((r) => !visibleIds.has(r.id)) : []
  const lastVisibleRepo = visibleRepos[visibleRepos.length - 1]
  const showMoreSeparator = !!lastVisibleRepo && lastVisibleRepo.id !== activeId && lastVisibleRepo.id !== hoveredId

  const openMenu = (
    <RepoTabEdgeAction showSeparator={showOpenSeparator}>
      <DropdownMenu>
        <Tip label={labels.open}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={labels.open}>
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent side="bottom" align="start" className="w-max">
          <DropdownMenuItem className="whitespace-nowrap" onSelect={onOpenLocal}>
            <FolderOpen />
            {labels.openLocal}
            {labels.openLocalShortcut && <DropdownMenuShortcut>{labels.openLocalShortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuItem className="whitespace-nowrap" onSelect={onOpenRemote}>
            <Server />
            {labels.openRemote}
            {labels.openRemoteShortcut && <DropdownMenuShortcut>{labels.openRemoteShortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuItem className="whitespace-nowrap" onSelect={onClone}>
            <Download />
            {labels.clone}
            {labels.cloneShortcut && <DropdownMenuShortcut>{labels.cloneShortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </RepoTabEdgeAction>
  )

  return (
    <nav className="flex h-full min-w-0 flex-1 items-center" aria-label={labels.repositories}>
      <ScrollArea orientation="horizontal" className="h-full min-w-0 flex-1" viewportClassName="[&>div]:h-full">
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {repos.length === 0 ? (
            openMenu
          ) : (
            <>
              {isSmallScreen ? (
                <RepoTabTooltipLayer repos={visibleRepos} className="flex h-full items-center gap-1" role="tablist">
                  {visibleRepos.map((repo) => (
                    <RepoTab
                      key={repo.id}
                      repo={repo}
                      isActive={repo.id === activeId}
                      showSeparator={false}
                      onHoverChange={setHoveredId}
                      onActivate={onActivate}
                      onClose={onClose}
                      onKeyboardNavigate={handleKeyboardNavigate}
                      closeLabel={labels.close}
                      unavailableLabel={labels.unavailable}
                    />
                  ))}
                  <RepoTabEdgeAction showSeparator={showMoreSeparator}>
                    <DropdownMenu>
                      <Tip label={labels.more}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={labels.more}>
                            <ChevronDown />
                          </Button>
                        </DropdownMenuTrigger>
                      </Tip>
                      <DropdownMenuContent side="bottom" align="start" className="w-max">
                        {overflowRepos.map((repo) => (
                          <DropdownMenuItem
                            key={repo.id}
                            className="whitespace-nowrap"
                            onSelect={() => onActivate(repo.id)}
                          >
                            <span className="truncate">{repo.name}</span>
                          </DropdownMenuItem>
                        ))}
                        {overflowRepos.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem className="whitespace-nowrap" onSelect={onOpenLocal}>
                          <FolderOpen />
                          {labels.openLocal}
                          {labels.openLocalShortcut && <DropdownMenuShortcut>{labels.openLocalShortcut}</DropdownMenuShortcut>}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="whitespace-nowrap" onSelect={onOpenRemote}>
                          <Server />
                          {labels.openRemote}
                          {labels.openRemoteShortcut && <DropdownMenuShortcut>{labels.openRemoteShortcut}</DropdownMenuShortcut>}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="whitespace-nowrap" onSelect={onClone}>
                          <Download />
                          {labels.clone}
                          {labels.cloneShortcut && <DropdownMenuShortcut>{labels.cloneShortcut}</DropdownMenuShortcut>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </RepoTabEdgeAction>
                </RepoTabTooltipLayer>
              ) : (
                <RepoTabTooltipLayer repos={repos} className="flex h-full items-center gap-1" role="tablist">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVisibleTabStrip]}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                      {repos.map((repo, index) => {
                        const next = repos[index + 1]
                        return (
                          <RepoTab
                            key={repo.id}
                            repo={repo}
                            isActive={repo.id === activeId}
                            showSeparator={shouldShowInactiveSeparator({
                              leftId: repo.id,
                              rightId: next?.id,
                              activeId,
                              hoveredId,
                            })}
                            onHoverChange={setHoveredId}
                            onActivate={onActivate}
                            onClose={onClose}
                            onKeyboardNavigate={handleKeyboardNavigate}
                            closeLabel={labels.close}
                            unavailableLabel={labels.unavailable}
                          />
                        )
                      })}
                    </SortableContext>
                  </DndContext>
                </RepoTabTooltipLayer>
              )}
              {!isSmallScreen && openMenu}
            </>
          )}
        </div>
      </ScrollArea>
    </nav>
  )
}
