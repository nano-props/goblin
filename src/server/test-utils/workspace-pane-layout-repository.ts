import {
  normalizeWorkspacePaneDurableLayout,
  workspacePaneDurableLayoutsEqual,
  type WorkspacePaneLayoutRepository,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface MemoryWorkspacePaneLayoutRepository extends WorkspacePaneLayoutRepository {
  layout: WorkspacePaneDurableLayout
}

export function createMemoryWorkspacePaneLayoutRepository(
  workspaceId: WorkspaceId,
  initial: WorkspacePaneDurableLayout = { entries: [] },
): MemoryWorkspacePaneLayoutRepository {
  let layout = structuredClone(initial)
  const assertWorkspace = (requestedWorkspaceId: WorkspaceId) => {
    if (requestedWorkspaceId !== workspaceId) throw new Error('memory workspace pane layout repository scope mismatch')
  }
  return {
    get layout() {
      return structuredClone(layout)
    },
    set layout(value) {
      layout = structuredClone(value)
    },
    async load(requestedWorkspaceId) {
      assertWorkspace(requestedWorkspaceId)
      return { layout: structuredClone(layout) }
    },
    async compareAndSwap(input) {
      assertWorkspace(input.workspaceId)
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
