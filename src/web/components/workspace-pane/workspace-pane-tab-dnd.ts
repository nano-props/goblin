import { useCallback, useMemo, type RefObject } from 'react'
import { KeyboardSensor, PointerSensor, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'
import type {
  WorkspacePaneRuntimeTabItem,
  WorkspacePaneStaticTabItem,
  WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'

export function useWorkspacePaneTabDnd({
  sortableItems,
  newButtonRef,
  disabled,
  onReorder,
}: {
  sortableItems: readonly (WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem)[]
  newButtonRef: RefObject<HTMLButtonElement | null>
  disabled: boolean
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictToVisibleTabStrip = useMemo(
    () => createRestrictToTabStripBounds({ rightBoundaryRef: newButtonRef }),
    [newButtonRef],
  )
  // Must be called unconditionally so the hook order stays stable across renders
  // (e.g. when worktree items go from 0 -> 1 or back).
  const sortableIds = useMemo(() => sortableItems.map((item) => item.sortableId), [sortableItems])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return
      const oldIndex = sortableItems.findIndex((item) => item.sortableId === activeId)
      const newIndex = sortableItems.findIndex((item) => item.sortableId === overId)
      if (oldIndex === -1 || newIndex === -1) return
      const activeItem = sortableItems[oldIndex]
      const overItem = sortableItems[newIndex]
      if (!activeItem || !overItem) return
      onReorder(
        arrayMove(
          sortableItems.map((item) => item.tabEntry),
          oldIndex,
          newIndex,
        ),
      )
    },
    [disabled, onReorder, sortableItems],
  )

  return {
    sensors,
    restrictToVisibleTabStrip,
    sortableIds,
    handleDragEnd,
  }
}

export type WorkspacePaneTabDnd = ReturnType<typeof useWorkspacePaneTabDnd>

export function isSortableWorkspacePaneTabItem(
  item: WorkspacePaneTabItem,
): item is WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem {
  return item.kind === 'static' || item.kind === 'runtime'
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
