import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  gitWorktreeWorkspacePaneTabsTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceTerminalSessionSummary } from '#/web/components/terminal/types.ts'

interface WorkspaceDashboardTerminalOrderInput {
  workspaceId: WorkspaceId
  sessions: readonly WorkspaceTerminalSessionSummary[]
  branches: readonly BranchSnapshotInfo[]
  paneTabs: WorkspacePaneTabsSnapshot | undefined
}

interface TerminalOrder {
  targetRank: number
  tabRank: number
  fallbackRank: number
}

/**
 * Dashboard order is a read-only composition of the repository branch order,
 * canonical pane-tab order, and live terminal authority. Missing projections
 * retain their incoming order and never hide an established terminal session.
 */
export function orderWorkspaceDashboardTerminals(
  input: WorkspaceDashboardTerminalOrderInput,
): WorkspaceTerminalSessionSummary[] {
  const branchRankByTarget = branchRankByTargetKey(input.workspaceId, input.branches)
  const tabRankByTarget = terminalTabRankByTargetKey(input.paneTabs)
  const fallbackTargetRank = new Map<string, number>()
  const firstFallbackTargetRank = input.branches.length + 1
  const orderBySessionId = new Map<string, TerminalOrder>()

  input.sessions.forEach((session, fallbackRank) => {
    const target = workspacePaneTabsTargetFromRuntime(session.base.target)
    const targetKey = target ? workspacePaneTabsTargetIdentityKey(target) : session.terminalFilesystemTargetKey
    let targetRank = target?.kind === 'workspace-root' ? 0 : branchRankByTarget.get(targetKey)
    if (targetRank === undefined) {
      const currentFallbackRank = fallbackTargetRank.get(targetKey)
      if (currentFallbackRank !== undefined) {
        targetRank = currentFallbackRank
      } else {
        targetRank = firstFallbackTargetRank + fallbackTargetRank.size
        fallbackTargetRank.set(targetKey, targetRank)
      }
    }
    orderBySessionId.set(session.terminalSessionId, {
      targetRank,
      tabRank: tabRankByTarget.get(targetKey)?.get(session.terminalSessionId) ?? Number.MAX_SAFE_INTEGER,
      fallbackRank,
    })
  })

  return [...input.sessions].sort((left, right) => {
    const leftOrder = orderBySessionId.get(left.terminalSessionId)
    const rightOrder = orderBySessionId.get(right.terminalSessionId)
    if (!leftOrder || !rightOrder) return 0
    return (
      leftOrder.targetRank - rightOrder.targetRank ||
      leftOrder.tabRank - rightOrder.tabRank ||
      leftOrder.fallbackRank - rightOrder.fallbackRank
    )
  })
}

function branchRankByTargetKey(
  workspaceId: WorkspaceId,
  branches: readonly BranchSnapshotInfo[],
): Map<string, number> {
  const ranks = new Map<string, number>()
  branches.forEach((branch, index) => {
    if (!branch.worktree) return
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, branch.worktree.path)
    if (target) ranks.set(workspacePaneTabsTargetIdentityKey(target), index + 1)
  })
  return ranks
}

function terminalTabRankByTargetKey(
  snapshot: WorkspacePaneTabsSnapshot | undefined,
): Map<string, Map<string, number>> {
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
