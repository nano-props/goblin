import path from 'node:path'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { TerminalCreateInput, TerminalCreateResult, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type {
  TerminalSessionEnsureInput,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import type { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { createTerminalWorkspaceTabsCoordinator } from '#/server/terminal/terminal-workspace-tabs-coordinator.ts'

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type TerminalWorkspaceTabsCoordinator = ReturnType<typeof createTerminalWorkspaceTabsCoordinator>
type TerminalCreateFailure = Extract<TerminalCreateResult, { ok: false }>

interface TerminalSessionCreatorOptions {
  createCoordinator: TerminalSessionCreateCoordinator
  workspaceTabsCoordinator: TerminalWorkspaceTabsCoordinator
  ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
  ): Promise<TerminalSessionEnsureResult>
  isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean
  rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoInstanceId'>,
    terminalRuntimeSessionId: string,
  ): TerminalCreateFailure | null
  listSessions(userId: string, repoRoot: string, repoInstanceId: string): Promise<TerminalSessionSummary[]>
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
    const sessionScope = terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoInstanceId)
    const scopedWorktreePath = terminalWorktreePath(input.request.repoRoot, input.request.worktreePath)
    return await this.options.createCoordinator.runInWorktreeQueue(
      { userId: input.userId, scope: sessionScope, worktreePath: scopedWorktreePath },
      async () => {
        if (!this.options.isCurrentRepoInstance(input.userId, input.request.repoRoot, input.request.repoInstanceId)) {
          return { ok: false, message: 'error.repo-instance-stale' }
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
        const staleAfterEnsure = this.options.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterEnsure) return staleAfterEnsure
        const sessions = await this.options.listSessions(
          input.userId,
          input.request.repoRoot,
          input.request.repoInstanceId,
        )
        const staleAfterList = this.options.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterList) return staleAfterList
        const createdSession = sessions.find((session) => session.terminalSessionId === createResult.terminalSessionId)
        const tabsResult = createdSession
          ? await this.options.workspaceTabsCoordinator.ensureTerminalTabForSession({
              userId: input.userId,
              scope: sessionScope,
              branchName: input.request.branch,
              worktreePath: createdSession.worktreePath,
              terminalSessionId: createResult.terminalSessionId,
              insertAfterIdentity: input.request.insertAfterIdentity ?? null,
              guardBeforeWrite: () =>
                this.options.rejectStaleCreateIfNeeded(
                  input.userId,
                  input.request,
                  createResult.terminalRuntimeSessionId,
                ),
            })
          : []
        if (isTerminalCreateFailure(tabsResult)) return tabsResult
        const tabs = tabsResult
        const staleAfterTabs = this.options.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterTabs) return staleAfterTabs
        return {
          ok: true,
          action: createResult.action,
          terminalSessionId: createResult.terminalSessionId,
          tabs,
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
          sessions,
        }
      },
    )
  }
}

export function createTerminalSessionCreator(options: TerminalSessionCreatorOptions): TerminalSessionCreator {
  return new TerminalSessionCreator(options)
}

function isTerminalCreateFailure(
  result: WorkspacePaneTabEntry[] | TerminalCreateFailure,
): result is TerminalCreateFailure {
  return !Array.isArray(result)
}

function terminalWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}
