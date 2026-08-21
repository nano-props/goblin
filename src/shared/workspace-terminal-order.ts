import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  gitWorktreeWorkspacePaneTabsTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface WorkspaceTerminalOrderInput<T> {
  workspaceId: WorkspaceId
  sessions: readonly T[]
  worktrees: readonly { path: string }[]
  paneTabs: WorkspacePaneTabsSnapshot | undefined
  terminalSessionId: (session: T) => string
  target: (session: T) => WorkspacePaneFilesystemExecutionTarget
}

interface TerminalOrder {
  targetRank: number
  tabRank: number
  fallbackRank: number
}

/** Canonical terminal ordering shared by the dashboard and shell projection. */
export function orderWorkspaceTerminals<T>(input: WorkspaceTerminalOrderInput<T>): T[] {
  const branchRankByTarget = worktreeRankByTargetKey(input.workspaceId, input.worktrees)
  const tabRankByTarget = terminalTabRankByTargetKey(input.paneTabs)
  const fallbackTargetRank = new Map<string, number>()
  const firstFallbackTargetRank = input.worktrees.length + 1
  const orderBySessionId = new Map<string, TerminalOrder>()

  input.sessions.forEach((session, fallbackRank) => {
    const target = workspacePaneTabsTargetFromRuntime(input.target(session))
    if (!target) throw new Error('terminal target is not a filesystem target')
    const targetKey = workspacePaneTabsTargetIdentityKey(target)
    let targetRank = target.kind === 'workspace-root' ? 0 : branchRankByTarget.get(targetKey)
    if (targetRank === undefined) {
      targetRank = fallbackTargetRank.get(targetKey)
      if (targetRank === undefined) {
        targetRank = firstFallbackTargetRank + fallbackTargetRank.size
        fallbackTargetRank.set(targetKey, targetRank)
      }
    }
    orderBySessionId.set(input.terminalSessionId(session), {
      targetRank,
      tabRank: tabRankByTarget.get(targetKey)?.get(input.terminalSessionId(session)) ?? Number.MAX_SAFE_INTEGER,
      fallbackRank,
    })
  })

  return [...input.sessions].sort((left, right) => {
    const leftOrder = orderBySessionId.get(input.terminalSessionId(left))
    const rightOrder = orderBySessionId.get(input.terminalSessionId(right))
    if (!leftOrder || !rightOrder) throw new Error('terminal ordering metadata is missing')
    return (
      leftOrder.targetRank - rightOrder.targetRank ||
      leftOrder.tabRank - rightOrder.tabRank ||
      leftOrder.fallbackRank - rightOrder.fallbackRank
    )
  })
}

function worktreeRankByTargetKey(
  workspaceId: WorkspaceId,
  worktrees: readonly { path: string }[],
): Map<string, number> {
  const ranks = new Map<string, number>()
  worktrees.forEach((worktree, index) => {
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktree.path)
    if (target) ranks.set(workspacePaneTabsTargetIdentityKey(target), index + 1)
  })
  return ranks
}

function terminalTabRankByTargetKey(snapshot: WorkspacePaneTabsSnapshot | undefined): Map<string, Map<string, number>> {
  const ranks = new Map<string, Map<string, number>>()
  for (const entry of snapshot?.entries ?? []) {
    const target = workspacePaneTabsTargetFromRuntime(entry.target)
    if (!target) continue
    const sessionRanks = new Map<string, number>()
    entry.tabs.forEach((tab, index) => {
      if (isWorkspacePaneRuntimeTabEntry(tab)) sessionRanks.set(tab.runtimeSessionId, index)
    })
    ranks.set(workspacePaneTabsTargetIdentityKey(target), sessionRanks)
  }
  return ranks
}
