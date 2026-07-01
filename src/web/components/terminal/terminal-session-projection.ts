import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import type {
  TerminalAttachResult,
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type {
  TerminalDescriptor,
  TerminalRepoIndex,
  TerminalSessionHydrationInput,
  TerminalIdentityViewModel,
} from '#/web/components/terminal/types.ts'

export interface ReattachSnapshotCacheEntry {
  ptySessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalAttachResultWithController = Extract<TerminalAttachResult, { ok: true }> & {
  role: TerminalIdentityViewModel['role']
  controllerStatus: TerminalIdentityViewModel['controllerStatus']
}

export interface ProjectedServerTerminalSession {
  descriptor: TerminalDescriptor
  terminalWorktreeKey: string
  hydrateInput: TerminalSessionHydrationInput
  controlsTerminal: boolean
}

export function projectTerminalAttachResultForClient(
  result: Extract<TerminalAttachResult, { ok: true }>,
  clientId: string,
): TerminalAttachResultWithController {
  return {
    ...result,
    ...resolveTerminalController(result.controller, clientId),
  }
}

export function projectServerTerminalSession(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  index: number
  serverSnapshot?: TerminalSessionSnapshot | null
  reattachSnapshot?: ReattachSnapshotCacheEntry | null
}): ProjectedServerTerminalSession | null {
  if (input.serverSession.repoRoot !== input.repoRoot) return null
  const branch = branchForTerminalWorktree(input.repoIndex, input.serverSession.repoRoot, input.serverSession.worktreePath)
  if (!branch) return null
  const descriptor = terminalDescriptor(
    { repoRoot: input.serverSession.repoRoot, branch, worktreePath: input.serverSession.worktreePath },
    input.serverSession.terminalSessionId,
    input.index,
  )
  const terminalWorktree = formatTerminalWorktreeKey(input.serverSession.repoRoot, input.serverSession.worktreePath)
  const controller = resolveTerminalController(input.serverSession.controller, input.clientId)
  const isReattachMatch = input.reattachSnapshot?.ptySessionId === input.serverSession.ptySessionId
  return {
    descriptor,
    terminalWorktreeKey: terminalWorktree,
    hydrateInput: {
      ptySessionId: input.serverSession.ptySessionId,
      processName: input.serverSession.processName,
      canonicalTitle: input.serverSession.canonicalTitle,
      phase: input.serverSession.phase,
      message: input.serverSession.message,
      role: controller.role,
      controllerStatus: controller.controllerStatus,
      canonicalCols: input.serverSession.cols,
      canonicalRows: input.serverSession.rows,
      snapshot: input.serverSnapshot?.snapshot ?? (isReattachMatch ? (input.reattachSnapshot?.snapshot ?? '') : ''),
      snapshotSeq:
        input.serverSnapshot?.snapshotSeq ?? (isReattachMatch ? (input.reattachSnapshot?.snapshotSeq ?? 0) : 0),
    },
    controlsTerminal: input.serverSession.controller?.clientId === input.clientId,
  }
}
