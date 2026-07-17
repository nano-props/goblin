import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabDragPreviewSnapshot {
  targetKey: string
  baseTabsIdentity: string
  tabs: WorkspacePaneTabEntry[]
}

type WorkspacePaneTabDragPreviewTarget =
  WorkspacePaneTabsTarget | { kind: 'inactive'; repoRoot: string; branchName: null; worktreePath: null }

export type WorkspacePaneTabDragPreviewInput = WorkspacePaneTabDragPreviewTarget & {
  repoRuntimeId: string
  canonicalTabs: readonly WorkspacePaneTabEntry[]
}

export interface WorkspacePaneTabDragPreviewState {
  visualTabs: readonly WorkspacePaneTabEntry[]
  /** Returns true when a non-noop preview was staged for the current tab target. */
  stageDragPreview: (tabs: readonly WorkspacePaneTabEntry[]) => boolean
  clearDragPreview: () => void
}

export function useWorkspacePaneTabDragPreview(
  input: WorkspacePaneTabDragPreviewInput,
): WorkspacePaneTabDragPreviewState {
  // Visual-only drag state. Runtime tab truth lives on the server and
  // React Query only caches that server projection; this hook must not
  // write either one.
  const targetKey = workspacePaneTabDragPreviewTargetKey(input)
  const canonicalTabsIdentity = useMemo(
    () => workspacePaneTabEntryListIdentity(input.canonicalTabs),
    [input.canonicalTabs],
  )
  const [dragPreview, setDragPreview] = useState<WorkspacePaneTabDragPreviewSnapshot | null>(null)
  const activeDragPreview =
    dragPreview &&
    targetKey !== null &&
    dragPreview.targetKey === targetKey &&
    dragPreview.baseTabsIdentity === canonicalTabsIdentity
      ? dragPreview
      : null

  useEffect(() => {
    if (dragPreview && !activeDragPreview) setDragPreview(null)
  }, [activeDragPreview, dragPreview])

  const clearDragPreview = useCallback(() => {
    setDragPreview(null)
  }, [])

  const stageDragPreview = useCallback(
    (tabs: readonly WorkspacePaneTabEntry[]) => {
      if (!targetKey) return false
      const nextTabs = [...tabs]
      if (workspacePaneTabEntryListIdentity(nextTabs) === canonicalTabsIdentity) {
        setDragPreview(null)
        return false
      }
      flushSync(() => {
        setDragPreview({
          targetKey,
          baseTabsIdentity: canonicalTabsIdentity,
          tabs: nextTabs,
        })
      })
      return true
    },
    [canonicalTabsIdentity, targetKey],
  )

  return {
    visualTabs: activeDragPreview ? activeDragPreview.tabs : input.canonicalTabs,
    stageDragPreview,
    clearDragPreview,
  }
}

function workspacePaneTabDragPreviewTargetKey(
  input: WorkspacePaneTabDragPreviewTarget & { repoRuntimeId: string },
): string | null {
  if ('kind' in input && input.kind === 'inactive') return null
  return `${workspacePaneTabsTargetIdentityKey(input)}::${input.repoRuntimeId}`
}
