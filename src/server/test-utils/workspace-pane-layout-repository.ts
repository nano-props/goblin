import {
  normalizeWorkspacePaneDurableLayout,
  workspacePaneDurableLayoutsEqual,
  type WorkspacePaneLayoutRepository,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'

export interface MemoryWorkspacePaneLayoutRepository extends WorkspacePaneLayoutRepository {
  layout: WorkspacePaneDurableLayout
}

export function createMemoryWorkspacePaneLayoutRepository(
  initial: WorkspacePaneDurableLayout = { entries: [] },
): MemoryWorkspacePaneLayoutRepository {
  let layout = structuredClone(initial)
  return {
    get layout() {
      return structuredClone(layout)
    },
    set layout(value) {
      layout = structuredClone(value)
    },
    async load() {
      return { layout: structuredClone(layout) }
    },
    async compareAndSwap(input) {
      if (!workspacePaneDurableLayoutsEqual(input.workspaceId, layout, input.expected)) {
        return { kind: 'conflict', snapshot: { layout: structuredClone(layout) } }
      }
      const replacement = normalizeWorkspacePaneDurableLayout(input.workspaceId, input.replacement)
      if (workspacePaneDurableLayoutsEqual(input.workspaceId, layout, replacement)) {
        return { kind: 'accepted', changed: false, snapshot: { layout: structuredClone(layout) } }
      }
      layout = structuredClone(replacement)
      return { kind: 'accepted', changed: true, snapshot: { layout: structuredClone(layout) } }
    },
  }
}
