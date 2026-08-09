import { Accessibility, KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import type { DragDropManager } from '@dnd-kit/dom'
import { scheduler } from '@dnd-kit/dom/utilities'
import type { DragDropProviderProps, DragEndEvent } from '@dnd-kit/vue'
import { isSortable } from '@dnd-kit/vue/sortable'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'
import type {
  WorkspacePaneRuntimeTabItem,
  WorkspacePaneStaticTabItem,
  WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'

type SortableWorkspacePaneTabItem = WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem

export interface WorkspacePaneTabDnd {
  modifiers: DragDropProviderProps['modifiers']
  plugins: DragDropProviderProps['plugins']
  sensors: DragDropProviderProps['sensors']
  handleDragEnd: (event: DragEndEvent) => void
}

class WorkspacePaneTabAccessibility extends Accessibility {
  constructor(manager: DragDropManager) {
    super(manager)

    this.registerEffect(() => {
      const tabActivators = Array.from(manager.registry.draggables.value, (draggable) => {
        // Subscribe alongside the built-in accessibility plugin so its
        // drag-state attribute update is sanitized in the same frame.
        void draggable.isDragging
        const activator = draggable.handle ?? draggable.element
        return activator?.getAttribute('role') === 'tab' ? activator : null
      }).filter((activator): activator is Element => activator !== null)

      queueMicrotask(() => {
        void scheduler.schedule(() => {
          for (const activator of tabActivators) {
            activator.setAttribute('aria-roledescription', 'sortable')
            activator.removeAttribute('aria-pressed')
            activator.removeAttribute('aria-grabbed')
          }
        })
      })
    })
  }
}

const workspacePaneTabPlugins: DragDropProviderProps['plugins'] = (defaultPlugins) =>
  defaultPlugins.map((plugin) => (plugin === Accessibility ? WorkspacePaneTabAccessibility : plugin))

const workspacePaneTabSensors: DragDropProviderProps['sensors'] = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
  KeyboardSensor,
]

export function useWorkspacePaneTabDnd(input: {
  sortableItems: () => readonly SortableWorkspacePaneTabItem[]
  disabled: () => boolean
  viewport: () => HTMLElement | null
  rightBoundary: () => HTMLElement | null
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}): WorkspacePaneTabDnd {
  return {
    modifiers: [
      createRestrictToTabStripBounds({
        viewport: input.viewport,
        rightBoundary: input.rightBoundary,
      }),
    ],
    plugins: workspacePaneTabPlugins,
    sensors: workspacePaneTabSensors,
    handleDragEnd: (event) => {
      if (event.canceled || input.disabled()) return
      const source = event.operation.source
      if (!isSortable(source)) return

      const items = input.sortableItems()
      const oldIndex = source.initialIndex
      const newIndex = source.index
      if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0) return
      if (oldIndex >= items.length || newIndex >= items.length) return

      input.onReorder(
        arrayMove(
          items.map((item) => item.tabEntry),
          oldIndex,
          newIndex,
        ),
      )
    },
  }
}

export function isSortableWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is SortableWorkspacePaneTabItem {
  return item.kind === 'static' || item.kind === 'runtime'
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
