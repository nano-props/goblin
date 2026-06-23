import { resolveTerminalOwnership } from '#/shared/terminal-ownership.ts'
import { parseSlotIdIndex } from '#/shared/slot-ids.ts'
import { parseTerminalSlotKey } from '#/shared/terminal-slot-key.ts'
import type {
  TerminalAttachResult,
  TerminalSlotSnapshot,
  TerminalSlotSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type {
  TerminalDescriptor,
  TerminalRepoIndex,
  TerminalSessionHydrationInput,
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

export interface ProjectedServerTerminalSession {
  descriptor: TerminalDescriptor
  worktreeTerminalKey: string
  hydrateInput: TerminalSessionHydrationInput
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

export function projectServerTerminalSession(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  serverSnapshot?: TerminalSlotSnapshot | null
  reattachSnapshot?: ReattachSnapshotCacheEntry | null
}): ProjectedServerTerminalSession | null {
  const parsed = parseTerminalSlotKey(input.serverSession.key)
  if (!parsed || parsed.repoRoot !== input.repoRoot) return null
  const branch = branchForTerminalWorktree(input.repoIndex, parsed.repoRoot, parsed.worktreePath)
  if (!branch) return null
  const descriptor = terminalDescriptor(
    { repoRoot: parsed.repoRoot, branch, worktreePath: parsed.worktreePath },
    parsed.slotId,
    parseSlotIdIndex(parsed.slotId) ?? 1,
  )
  const terminalWorktree = worktreeTerminalKey(parsed.repoRoot, parsed.worktreePath)
  const ownership = resolveTerminalOwnership(input.serverSession.controller, input.clientId)
  const isReattachMatch = input.reattachSnapshot?.ptySessionId === input.serverSession.ptySessionId
  return {
    descriptor,
    worktreeTerminalKey: terminalWorktree,
    hydrateInput: {
      ptySessionId: input.serverSession.ptySessionId,
      processName: input.serverSession.processName,
      canonicalTitle: input.serverSession.canonicalTitle,
      phase: input.serverSession.phase,
      message: input.serverSession.message,
      role: ownership.role,
      controllerStatus: ownership.controllerStatus,
      canonicalCols: input.serverSession.cols,
      canonicalRows: input.serverSession.rows,
      snapshot: input.serverSnapshot?.snapshot ?? (isReattachMatch ? (input.reattachSnapshot?.snapshot ?? '') : ''),
      snapshotSeq:
        input.serverSnapshot?.snapshotSeq ?? (isReattachMatch ? (input.reattachSnapshot?.snapshotSeq ?? 0) : 0),
    },
    controlsTerminal: input.serverSession.controller?.clientId === input.clientId,
    displayOrder: input.serverSession.displayOrder,
  }
}
