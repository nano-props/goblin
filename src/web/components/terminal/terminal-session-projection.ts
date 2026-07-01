import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import type {
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalSessionBase,
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

export interface ProjectedCreateTerminalSessions {
  serverSessions: ServerTerminalSessionSummary[]
  snapshotByPtySessionId: Map<string, TerminalSessionSnapshot>
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
): ProjectedCreateTerminalSessions {
  const targetSession = createSessionSummaryFromCreate(base, result)
  let sawTarget = false
  const serverSessions = result.sessions.map((session) => {
    if (session.terminalSessionId !== result.terminalSessionId) return session
    sawTarget = true
    return session.ptySessionId === result.ptySessionId ? session : targetSession
  })
  if (!sawTarget) serverSessions.push(targetSession)
  return {
    serverSessions,
    snapshotByPtySessionId: new Map<string, TerminalSessionSnapshot>([
      [result.ptySessionId, { ptySessionId: result.ptySessionId, snapshot: result.snapshot, snapshotSeq: result.snapshotSeq }],
    ]),
  }
}

export function projectServerTerminalSession(input: {
  repoIndex: TerminalRepoIndex
  repoRoot: string
  serverSession: ServerTerminalSessionSummary
  clientId: string
  index: number
  serverSnapshot?: TerminalSessionSnapshot | null
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
      snapshot: input.serverSnapshot?.snapshot ?? '',
      snapshotSeq: input.serverSnapshot?.snapshotSeq ?? 0,
    },
    controlsTerminal: input.serverSession.controller?.clientId === input.clientId,
  }
}

function createSessionSummaryFromCreate(
  base: TerminalSessionBase,
  result: Extract<TerminalCreateResult, { ok: true }>,
): ServerTerminalSessionSummary {
  return {
    ptySessionId: result.ptySessionId,
    terminalSessionId: result.terminalSessionId,
    repoRoot: base.repoRoot,
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
