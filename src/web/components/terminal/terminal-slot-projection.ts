import { resolveTerminalOwnership } from '#/shared/terminal-ownership.ts'
import { parseSlotIdIndex } from '#/shared/slot-ids.ts'
import { parseTerminalSlotKey } from '#/shared/terminal-slot-key.ts'
import type {
  TerminalAttachResult,
  TerminalSlotSnapshot,
  TerminalSlotSummary as ServerTerminalSlotSummary,
} from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import type {
  TerminalDescriptor,
  TerminalRepoIndex,
  TerminalSlotHydrationInput,
  TerminalOwnershipViewModel,
} from '#/web/components/terminal/types.ts'

export interface ReattachSnapshotCacheEntry {
  ptySessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalAttachResultWithOwnership = Extract<TerminalAttachResult, { ok: true }> & {
  role: TerminalOwnershipViewModel['role']
  controllerStatus: TerminalOwnershipViewModel['controllerStatus']
}

export interface ProjectedServerTerminalSlot {
  descriptor: TerminalDescriptor
  worktreeTerminalKey: string
  hydrateInput: TerminalSlotHydrationInput
  controlsTerminal: boolean
  displayOrder: number
}

export function projectTerminalAttachResultForClient(
  result: Extract<TerminalAttachResult, { ok: true }>,
  clientId: string,
): TerminalAttachResultWithOwnership {
  return {
    ...result,
    ...resolveTerminalOwnership(result.controller, clientId),
  }
}

export function projectServerTerminalSlot(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  serverSlot: ServerTerminalSlotSummary
  clientId: string
  serverSnapshot?: TerminalSlotSnapshot | null
  reattachSnapshot?: ReattachSnapshotCacheEntry | null
}): ProjectedServerTerminalSlot | null {
  const parsed = parseTerminalSlotKey(input.serverSlot.key)
  if (!parsed || parsed.repoRoot !== input.repoRoot) return null
  const branch = branchForTerminalWorktree(input.repoIndex, parsed.repoRoot, parsed.worktreePath)
  if (!branch) return null
  const descriptor = terminalDescriptor(
    { repoRoot: parsed.repoRoot, branch, worktreePath: parsed.worktreePath },
    parsed.slotId,
    parseSlotIdIndex(parsed.slotId) ?? 1,
  )
  const terminalWorktree = worktreeTerminalKey(parsed.repoRoot, parsed.worktreePath)
  const ownership = resolveTerminalOwnership(input.serverSlot.controller, input.clientId)
  const isReattachMatch = input.reattachSnapshot?.ptySessionId === input.serverSlot.ptySessionId
  return {
    descriptor,
    worktreeTerminalKey: terminalWorktree,
    hydrateInput: {
      ptySessionId: input.serverSlot.ptySessionId,
      processName: input.serverSlot.processName,
      canonicalTitle: input.serverSlot.canonicalTitle,
      phase: input.serverSlot.phase,
      message: input.serverSlot.message,
      role: ownership.role,
      controllerStatus: ownership.controllerStatus,
      canonicalCols: input.serverSlot.cols,
      canonicalRows: input.serverSlot.rows,
      snapshot: input.serverSnapshot?.snapshot ?? (isReattachMatch ? (input.reattachSnapshot?.snapshot ?? '') : ''),
      snapshotSeq:
        input.serverSnapshot?.snapshotSeq ?? (isReattachMatch ? (input.reattachSnapshot?.snapshotSeq ?? 0) : 0),
    },
    controlsTerminal: input.serverSlot.controller?.clientId === input.clientId,
    displayOrder: input.serverSlot.displayOrder,
  }
}
