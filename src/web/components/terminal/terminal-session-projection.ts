import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import type {
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalSessionBase,
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

export interface ProjectedCreateTerminalSession {
  serverSession: ServerTerminalSessionSummary
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

export function projectCreateResultForClient(
  base: TerminalSessionBase,
  result: Extract<TerminalCreateResult, { ok: true }>,
): ProjectedCreateTerminalSession {
  return {
    serverSession: createSessionSummaryFromCreate(base, result),
  }
}

export function projectServerTerminalSession(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  repoRuntimeId: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  index: number
}): ProjectedServerTerminalSession | null {
  if (input.serverSession.repoRoot !== input.repoRoot) return null
  if (input.serverSession.repoRuntimeId !== input.repoRuntimeId) return null
  const branch =
    branchForTerminalWorktree(input.repoIndex, input.serverSession.repoRoot, input.serverSession.worktreePath) ||
    input.serverSession.branch
  if (!branch) return null
  const descriptor = terminalDescriptor(
    {
      repoRoot: input.serverSession.repoRoot,
      repoRuntimeId: input.serverSession.repoRuntimeId,
      branch,
      worktreePath: input.serverSession.worktreePath,
    },
    input.serverSession.terminalSessionId,
    input.index,
  )
  const terminalWorktree = formatTerminalWorktreeKey(input.serverSession.repoRoot, input.serverSession.worktreePath)
  const controller = resolveTerminalController(input.serverSession.controller, input.clientId)
  return {
    descriptor,
    terminalWorktreeKey: terminalWorktree,
    hydrateInput: {
      terminalRuntimeSessionId: input.serverSession.terminalRuntimeSessionId,
      terminalRuntimeGeneration: input.serverSession.terminalRuntimeGeneration,
      processName: input.serverSession.processName,
      canonicalTitle: input.serverSession.canonicalTitle,
      phase: input.serverSession.phase,
      message: input.serverSession.message,
      role: controller.role,
      controllerStatus: controller.controllerStatus,
      canonicalCols: input.serverSession.cols,
      canonicalRows: input.serverSession.rows,
      snapshot: null,
      snapshotSeq: 0,
      outputEra: 0,
    },
    controlsTerminal: input.serverSession.controller?.clientId === input.clientId,
  }
}

function createSessionSummaryFromCreate(
  base: TerminalSessionBase,
  result: Extract<TerminalCreateResult, { ok: true }>,
): ServerTerminalSessionSummary {
  return {
    terminalRuntimeSessionId: result.terminalRuntimeSessionId,
    terminalRuntimeGeneration: result.terminalRuntimeGeneration,
    terminalSessionId: result.terminalSessionId,
    repoRuntimeId: requireBaseRepoRuntimeId(base),
    repoRoot: base.repoRoot,
    branch: result.branch,
    worktreePath: base.worktreePath,
    cwd: base.worktreePath,
    controller: result.controller,
    processName: result.processName,
    canonicalTitle: result.canonicalTitle,
    phase: result.phase,
    message: result.message,
    cols: result.canonicalCols,
    rows: result.canonicalRows,
  }
}

function requireBaseRepoRuntimeId(base: TerminalSessionBase): string {
  if (typeof base.repoRuntimeId === 'string' && base.repoRuntimeId.length > 0) return base.repoRuntimeId
  throw new Error('error.repo-runtime-stale')
}
