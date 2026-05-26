import { useState } from 'react'
import { Download, FolderOpen, Plus } from 'lucide-react'
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
import { Button } from '#/renderer/components/ui/button.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '#/renderer/components/ui/dropdown-menu.tsx'
import { RepoTab } from '#/renderer/components/repo-tabs/RepoTab.tsx'
import { TabTooltipLayer } from '#/renderer/components/repo-tabs/TabTooltipLayer.tsx'
import { MissingReposPopover } from '#/renderer/components/repo-tabs/MissingReposPopover.tsx'
import type { RepoTabStripLabels, RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'
import type { MissingRepo } from '#/renderer/stores/repos/types.ts'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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
  missing: MissingRepo[]
  labels: RepoTabStripLabels
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (activeId: string, overId: string) => void
  onOpenLocal: () => void
  onClone: () => void
  onDismissMissing: () => void
}

export function RepoTabStrip({
  repos,
  activeId,
  missing,
  labels,
  onActivate,
  onClose,
  onReorder,
  onOpenLocal,
  onClone,
  onDismissMissing,
}: RepoTabStripProps) {
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

  return (
    <nav className="relative h-10 shrink-0 bg-muted/60" aria-label={labels.repositories}>
      <div className="absolute inset-x-0 top-0 bottom-px flex items-center gap-2 px-2">
        <ScrollArea orientation="horizontal" className="h-full min-w-0 flex-1" viewportClassName="[&>div]:h-full">
          <TabTooltipLayer repos={repos} className="flex h-full w-max min-w-full items-center gap-1" role="tablist">
            {repos.length === 0 ? (
              <div className="flex h-8 items-center px-2 text-xs text-muted-foreground">
                {labels.emptyBefore}
                <span className="text-foreground">{labels.emptyOpenLabel}</span>
                {labels.emptyAfter}
              </div>
            ) : (
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
                      />
                    )
                  })}
                </SortableContext>
              </DndContext>
            )}
          </TabTooltipLayer>
        </ScrollArea>
        <MissingReposPopover
          missing={missing}
          title={labels.missingTitle}
          dismissLabel={labels.missingDismiss}
          onDismiss={onDismissMissing}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={labels.open}
              title={labels.open}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            <DropdownMenuItem className="whitespace-nowrap" onSelect={onOpenLocal}>
              <FolderOpen />
              {labels.openLocal}
              {labels.openLocalShortcut && <DropdownMenuShortcut>{labels.openLocalShortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
            <DropdownMenuItem className="whitespace-nowrap" onSelect={onClone}>
              <Download />
              {labels.clone}
              {labels.cloneShortcut && <DropdownMenuShortcut>{labels.cloneShortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-separator" />
    </nav>
  )
}
