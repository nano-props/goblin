import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabDragPreviewSnapshot {
  targetKey: string
  baseTabsIdentity: string
  tabs: WorkspacePaneTabEntry[]
}

export interface WorkspacePaneTabDragPreviewInput {
  repoRoot: string
  branchName: string | null
  worktreePath: string | null
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
  const targetKey = useMemo(
    () =>
      input.branchName
        ? workspacePaneTabDragPreviewTargetKey({
            repoRoot: input.repoRoot,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          })
        : null,
    [input.branchName, input.repoRoot, input.worktreePath],
  )
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

function workspacePaneTabDragPreviewTargetKey(input: {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}): string {
  return workspacePaneTabsTargetIdentityKey(input)
}
