import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import { terminalSessionRuntimeScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import type {
  TerminalSessionEnsureInput,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import type { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { PhysicalWorktreeCapability } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type TerminalCreateFailure = Extract<TerminalCreateResult, { ok: false }>

interface TerminalSessionCreatorOptions {
  createCoordinator: TerminalSessionCreateCoordinator
  ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
    physicalWorktreeCapability: PhysicalWorktreeCapability,
    signal: AbortSignal,
  ): Promise<TerminalSessionEnsureResult>
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoRuntimeId'>,
    terminalRuntimeSessionId: string,
  ): Promise<TerminalCreateFailure | null>
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
    physicalWorktreeCapability: PhysicalWorktreeCapability
    signal: AbortSignal
  }): Promise<TerminalCreateResult> {
    const signal = input.signal
    const sessionScope = terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoRuntimeId)
    const scopedWorktreePath = terminalSessionWorktreePath(input.request.repoRoot, input.request.worktreePath)
    return await this.options.createCoordinator.runInWorktreeQueue(
      { userId: input.userId, scope: sessionScope, worktreePath: scopedWorktreePath },
      async () => {
        if (signal.aborted) return { ok: false, message: 'error.repo-runtime-stale' }
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
            }, input.physicalWorktreeCapability, signal),
        )
        if (!createResult.ok) return { ok: false, message: createResult.message }
        const staleAfterEnsure = await this.options.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterEnsure) return staleAfterEnsure
        return {
          ok: true,
          action: createResult.action,
          terminalSessionId: createResult.terminalSessionId,
          terminalSessionsRevision: createResult.terminalSessionsRevision,
          terminalRuntimeSessionId: createResult.terminalRuntimeSessionId,
          terminalRuntimeGeneration: createResult.terminalRuntimeGeneration,
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
        }
      },
    )
  }
}

export function createTerminalSessionCreator(options: TerminalSessionCreatorOptions): TerminalSessionCreator {
  return new TerminalSessionCreator(options)
}
