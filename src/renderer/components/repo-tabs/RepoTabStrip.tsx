import { useState } from 'react'
import { Plus } from 'lucide-react'
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
import { Tip } from '#/renderer/components/Tip.tsx'
import { RepoTab } from '#/renderer/components/repo-tabs/RepoTab.tsx'
import { MissingReposPopover } from '#/renderer/components/repo-tabs/MissingReposPopover.tsx'
import type { RepoTabStripLabels, RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'
import type { MissingRepo } from '#/renderer/stores/repos/types.ts'

const restrictToHorizontalTabs: Modifier = ({ transform }) => ({ ...transform, y: 0 })

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
  onOpen: () => void
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
  onOpen,
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
    <nav
      className="flex h-10 shrink-0 items-center gap-2 border-b border-separator bg-muted/60 px-2"
      aria-label={labels.repositories}
    >
      <div
        className="scroll-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden"
        role="tablist"
      >
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
            modifiers={[restrictToHorizontalTabs]}
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
      </div>
      <MissingReposPopover
        missing={missing}
        title={labels.missingTitle}
        dismissLabel={labels.missingDismiss}
        onDismiss={onDismissMissing}
      />
      <Tip label={labels.open}>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onOpen} aria-label={labels.open}>
          <Plus />
        </Button>
      </Tip>
    </nav>
  )
}
