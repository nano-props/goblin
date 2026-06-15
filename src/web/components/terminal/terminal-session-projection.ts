import { resolveTerminalOwnership } from '#/shared/terminal-ownership.ts'
import { parseTerminalIdIndex } from '#/shared/terminal-ids.ts'
import { parseTerminalSessionKey } from '#/shared/terminal-session-key.ts'
import type {
  TerminalAttachResult,
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
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
  sessionId: string
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
  controlsAttachment: boolean
  displayOrder: number
}

export function projectTerminalAttachResultForAttachment(
  result: Extract<TerminalAttachResult, { ok: true }>,
  attachmentId: string,
): TerminalAttachResultWithOwnership {
  return {
    ...result,
    ...resolveTerminalOwnership(result.controller, attachmentId),
  }
}

export function projectServerTerminalSession(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  serverSession: ServerTerminalSessionSummary
  attachmentId: string
  serverSnapshot?: TerminalSessionSnapshot | null
  reattachSnapshot?: ReattachSnapshotCacheEntry | null
}): ProjectedServerTerminalSession | null {
  const parsed = parseTerminalSessionKey(input.serverSession.key)
  if (!parsed || parsed.repoRoot !== input.repoRoot) return null
  const branch = branchForTerminalWorktree(input.repoIndex, parsed.repoRoot, parsed.worktreePath)
  if (!branch) return null
  const descriptor = terminalDescriptor(
    { repoRoot: parsed.repoRoot, branch, worktreePath: parsed.worktreePath },
    parsed.terminalId,
    parseTerminalIdIndex(parsed.terminalId) ?? 1,
  )
  const terminalWorktree = worktreeTerminalKey(parsed.repoRoot, parsed.worktreePath)
  const ownership = resolveTerminalOwnership(input.serverSession.controller, input.attachmentId)
  const isReattachMatch = input.reattachSnapshot?.sessionId === input.serverSession.sessionId
  return {
    descriptor,
    worktreeTerminalKey: terminalWorktree,
    hydrateInput: {
      sessionId: input.serverSession.sessionId,
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
    controlsAttachment: input.serverSession.controller?.attachmentId === input.attachmentId,
    displayOrder: input.serverSession.displayOrder,
  }
}
