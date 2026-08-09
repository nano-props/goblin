import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabDragPreviewSnapshot {
  baseTabsIdentity: string
  tabs: WorkspacePaneTabEntry[]
}

export type WorkspacePaneTabDragPreviewRelease = () => void

export interface WorkspacePaneTabDragPreviewState {
  visualTabs: ComputedRef<readonly WorkspacePaneTabEntry[]>
  /** Returns a transaction-scoped release when a non-noop preview was staged. */
  stageDragPreview: (tabs: readonly WorkspacePaneTabEntry[]) => WorkspacePaneTabDragPreviewRelease | null
}

export function useWorkspacePaneTabDragPreview(
  canonicalTabs: () => readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabDragPreviewState {
  // This state is owned by one keyed toolbar target. The server projection
  // remains authoritative; each accepted reorder owns one preview lease until
  // its transaction settles.
  const dragPreview = shallowRef<WorkspacePaneTabDragPreviewSnapshot | null>(null)
  const visualTabs = computed(() => {
    const currentTabs = canonicalTabs()
    const preview = dragPreview.value
    return preview && preview.baseTabsIdentity === workspacePaneTabEntryListIdentity(currentTabs)
      ? preview.tabs
      : currentTabs
  })

  const stageDragPreview = (tabs: readonly WorkspacePaneTabEntry[]) => {
    const currentTabs = canonicalTabs()
    const baseTabsIdentity = workspacePaneTabEntryListIdentity(currentTabs)
    const nextTabs = [...tabs]
    if (workspacePaneTabEntryListIdentity(nextTabs) === baseTabsIdentity) return null

    const snapshot: WorkspacePaneTabDragPreviewSnapshot = { baseTabsIdentity, tabs: nextTabs }
    dragPreview.value = snapshot
    return () => {
      if (dragPreview.value === snapshot) dragPreview.value = null
    }
  }

  return { visualTabs, stageDragPreview }
}
