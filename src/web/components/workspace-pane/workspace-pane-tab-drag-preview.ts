import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabDragPreview {
  targetKey: string
  sourceIdentity: string
  tabs: WorkspacePaneTabEntry[]
}

export function useWorkspacePaneTabDragPreview(input: {
  repoRoot: string
  branchName: string | null
  worktreePath: string | null
  canonicalTabs: readonly WorkspacePaneTabEntry[]
}): {
  visualTabs: readonly WorkspacePaneTabEntry[]
  stageDragPreview: (tabs: readonly WorkspacePaneTabEntry[]) => boolean
  clearDragPreview: () => void
} {
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
  const canonicalIdentity = useMemo(
    () => workspacePaneTabEntryListIdentity(input.canonicalTabs),
    [input.canonicalTabs],
  )
  const [dragPreview, setDragPreview] = useState<WorkspacePaneTabDragPreview | null>(null)
  const activeDragPreview =
    dragPreview &&
    targetKey &&
    dragPreview.targetKey === targetKey &&
    dragPreview.sourceIdentity === canonicalIdentity
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
      if (workspacePaneTabEntryListIdentity(nextTabs) === canonicalIdentity) {
        setDragPreview(null)
        return false
      }
      flushSync(() => {
        setDragPreview({
          targetKey,
          sourceIdentity: canonicalIdentity,
          tabs: nextTabs,
        })
      })
      return true
    },
    [canonicalIdentity, targetKey],
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
  return `${input.repoRoot}\0${input.branchName}\0${input.worktreePath ?? ''}`
}
