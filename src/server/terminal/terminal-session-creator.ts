import path from 'node:path'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { TerminalCreateInput, TerminalCreateResult, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type {
  TerminalSessionEnsureInput,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import type { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type TerminalCreateFailure = Extract<TerminalCreateResult, { ok: false }>

interface TerminalSessionCreatorOptions {
  createCoordinator: TerminalSessionCreateCoordinator
  ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
  ): Promise<TerminalSessionEnsureResult>
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoRuntimeId'>,
    terminalRuntimeSessionId: string,
  ): TerminalCreateFailure | null
  cleanupStaleCreate(userId: string, input: Pick<TerminalCreateInput, 'repoRoot' | 'repoRuntimeId'>): Promise<void>
  listSessions(userId: string, repoRoot: string, repoRuntimeId: string): Promise<TerminalSessionSummary[]>
}

class TerminalSessionCreator {
  private readonly options: TerminalSessionCreatorOptions

  constructor(options: TerminalSessionCreatorOptions) {
    this.options = options
  }

  async create(input: {
    clientId: string
    terminalClientId: string
    userId: string
    request: TerminalCreateInput
  }): Promise<TerminalCreateResult> {
    const sessionScope = terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoRuntimeId)
    const scopedWorktreePath = terminalWorktreePath(input.request.repoRoot, input.request.worktreePath)
    return await this.options.createCoordinator.runInWorktreeQueue(
      { userId: input.userId, scope: sessionScope, worktreePath: scopedWorktreePath },
      async () => {
        if (!this.options.isCurrentRepoRuntime(input.userId, input.request.repoRoot, input.request.repoRuntimeId)) {
          return { ok: false, message: 'error.repo-runtime-stale' }
        }
        const createResult = await this.options.createCoordinator.withSessionIdAllocation(
          { userId: input.userId, scope: sessionScope, worktreePath: scopedWorktreePath, kind: input.request.kind },
          async ({ terminalSessionId }) =>
            await this.options.ensureOrRestore(input.clientId, input.userId, {
              ...input.request,
              clientId: input.terminalClientId,
              terminalSessionId,
            }),
        )
        if (!createResult.ok) return { ok: false, message: createResult.message }
        const staleAfterEnsure = await this.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterEnsure) return staleAfterEnsure
        const sessions = await this.options.listSessions(
          input.userId,
          input.request.repoRoot,
          input.request.repoRuntimeId,
        )
        const staleAfterList = await this.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterList) return staleAfterList
        const staleAfterSessions = await this.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterSessions) return staleAfterSessions
        return {
          ok: true,
          action: createResult.action,
          terminalSessionId: createResult.terminalSessionId,
          terminalRuntimeSessionId: createResult.terminalRuntimeSessionId,
          processName: createResult.processName,
          canonicalTitle: createResult.canonicalTitle,
          phase: createResult.phase,
          message: createResult.message,
          snapshot: createResult.snapshot,
          snapshotSeq: createResult.snapshotSeq,
          outputEra: createResult.outputEra,
          controller: createResult.controller,
          canonicalCols: createResult.canonicalCols,
          canonicalRows: createResult.canonicalRows,
          sessions: sessions,
        }
      },
    )
  }

  private async rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoRuntimeId'>,
    terminalRuntimeSessionId: string,
  ): Promise<TerminalCreateFailure | null> {
    const failure = this.options.rejectStaleCreateIfNeeded(userId, input, terminalRuntimeSessionId)
    if (!failure) return null
    await this.options.cleanupStaleCreate(userId, input)
    return failure
  }
}

export function createTerminalSessionCreator(options: TerminalSessionCreatorOptions): TerminalSessionCreator {
  return new TerminalSessionCreator(options)
}

function terminalWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}
