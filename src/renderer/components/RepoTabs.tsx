// Left sidebar — one row per opened repository. Click to focus, hover to
// reveal the close (×) button. The active row gets a left accent border
// and surface-coloured background so it pops against the deeper sidebar
// fill.
//
// Drag-to-reorder uses dnd-kit (the de-facto choice in the React/shadcn/
// tanstack ecosystem — accessible by default, works with pointer/touch/
// keyboard, ~30 KB). PointerSensor with a small activation distance lets
// a regular click still focus the repo without triggering a drag, and
// KeyboardSensor makes Space/Arrows reorder for keyboard users.

import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { AlertCircle, GripVertical, X } from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { tildify } from '#/renderer/lib/paths.ts'

/** Sidebar row data. Projecting RepoState down to these three string
 *  fields means subscribing to `s.repos` doesn't make us re-render
 *  on every refresh of branches/log/status. */
interface TabSummary {
  id: string
  name: string
  currentBranch: string
}

/** Equality fn for the summaries array. Zustand's `useShallow` does
 *  Object.is on each element — but we re-create the inner objects
 *  every selector run, so refs always differ. Compare the relevant
 *  string fields explicitly so the sidebar only re-renders when the
 *  rendered text actually changes. */
function summariesEqual(a: TabSummary[], b: TabSummary[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.name !== y.name || x.currentBranch !== y.currentBranch) return false
  }
  return true
}

interface RowProps {
  repo: TabSummary
  isActive: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
  closeLabel: string
  dragLabel: string
}

function SortableRow({ repo, isActive, onActivate, onClose, closeLabel, dragLabel }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: repo.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-interactive
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={() => onActivate(repo.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate(repo.id)
        }
      }}
      className={cn(
        'group flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 text-sm transition-colors duration-100',
        isActive
          ? 'border-brand bg-card text-foreground'
          : 'border-transparent text-foreground hover:bg-background hover:text-foreground',
        // Lift the dragged row a hair so it visually separates from the
        // list while moving — also ensures it sits on top during overlap.
        isDragging && 'shadow-md ring-1 ring-border z-10 relative bg-card',
      )}
    >
      <button
        type="button"
        // dnd-kit listeners attach to the handle so plain clicks on the
        // body still focus the repo. attributes go on the handle too so
        // Space/Arrows pick up that element for keyboard reordering.
        {...attributes}
        {...listeners}
        // Stop click bubbling to the row's onClick — we don't want the
        // handle press to also re-activate the repo.
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 -ml-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none"
        aria-label={dragLabel}
        title={dragLabel}
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{repo.name}</div>
        <div className="truncate text-xs text-muted-foreground">{repo.currentBranch || tildify(repo.id)}</div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose(repo.id)
        }}
        className="opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground hover:bg-accent hover:text-accent-foreground p-0.5 rounded transition-colors duration-100"
        title={closeLabel}
        aria-label={closeLabel}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function RepoTabs() {
  const t = useT()
  // Build the summary array inside the selector but compare with our
  // explicit equality fn so re-derivations with identical contents
  // don't trigger a re-render. Zustand v5's primary `useReposStore`
  // hook drops the second-arg equality fn — `useStoreWithEqualityFn`
  // from `zustand/traditional` is the v5 escape hatch for cases like
  // this where shallow on Object.is misses the structurally-equal
  // case.
  const summaries = useStoreWithEqualityFn(
    useReposStore,
    (s) =>
      s.order
        .map<TabSummary | null>((id) => {
          const r = s.repos[id]
          return r ? { id: r.id, name: r.name, currentBranch: r.currentBranch } : null
        })
        .filter((x): x is TabSummary => x !== null),
    summariesEqual,
  )
  const activeId = useReposStore((s) => s.activeId)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const reorderRepos = useReposStore((s) => s.reorderRepos)
  const missing = useReposStore(useShallow((s) => s.missingFromSession))
  const dismissMissing = useReposStore((s) => s.dismissMissing)

  // 6px activation distance so a quick click on the handle still selects
  // the row (handle press becomes a drag only after the user actually
  // moves the cursor). Without this, every press would start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    reorderRepos(String(active.id), String(over.id))
  }

  const ids = summaries.map((s) => s.id)

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
        {t('sidebar.repos')}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {summaries.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed">
            {t('sidebar.empty.before')}
            <span className="text-foreground">{t('sidebar.empty.openLabel')}</span>
            {t('sidebar.empty.after')}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {summaries.map((repo) => (
                <SortableRow
                  key={repo.id}
                  repo={repo}
                  isActive={repo.id === activeId}
                  onActivate={setActive}
                  onClose={closeRepo}
                  closeLabel={t('sidebar.close')}
                  dragLabel={t('sidebar.dragToReorder')}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {missing.length > 0 && (
          <div className="border-t border-border mt-2 pt-2 px-3 pb-3">
            <div className="flex items-start gap-1.5 text-xs">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-warning" />
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-medium mb-1">
                  {t('sidebar.missingTitle', { n: missing.length })}
                </div>
                <ul className="space-y-0.5 mb-2">
                  {missing.map((p) => (
                    <li key={p} className="truncate font-mono text-[11px] text-muted-foreground" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={dismissMissing}
                  className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors duration-100"
                >
                  {t('sidebar.missingDismiss')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
