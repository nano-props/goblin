import path from 'node:path'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { TerminalCreateInput, TerminalCreateResult, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabSessionId,
} from '#/shared/workspace-pane.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type {
  TerminalSessionEnsureInput,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import type { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type WorkspacePaneTabsCoordinator = ReturnType<typeof createWorkspacePaneTabsCoordinator>
type TerminalCreateFailure = Extract<TerminalCreateResult, { ok: false }>

interface TerminalSessionCreatorOptions {
  createCoordinator: TerminalSessionCreateCoordinator
  workspaceTabsCoordinator: WorkspacePaneTabsCoordinator
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
  cleanupStaleCreate(userId: string, input: Pick<TerminalCreateInput, 'repoRoot' | 'repoInstanceId'>): Promise<void>
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
        const staleAfterEnsure = await this.rejectStaleCreateIfNeeded(
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
        const staleAfterList = await this.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterList) return staleAfterList
        const createdSession = sessions.find((session) => session.terminalSessionId === createResult.terminalSessionId)
        const tabsResult = createdSession
          ? await this.options.workspaceTabsCoordinator.ensureRuntimeTabForSession({
              userId: input.userId,
              scope: sessionScope,
              branchName: input.request.branch,
              worktreePath: createdSession.worktreePath,
              runtimeType: 'terminal',
              sessionId: createResult.terminalSessionId,
              insertAfterIdentity: input.request.insertAfterIdentity ?? null,
              guardBeforeWrite: () =>
                this.options.rejectStaleCreateIfNeeded(
                  input.userId,
                  input.request,
                  createResult.terminalRuntimeSessionId,
                ),
            })
          : []
        if (isTerminalCreateFailure(tabsResult)) {
          await this.options.cleanupStaleCreate(input.userId, input.request)
          return tabsResult
        }
        const tabs = tabsResult
        const staleAfterTabs = await this.rejectStaleCreateIfNeeded(
          input.userId,
          input.request,
          createResult.terminalRuntimeSessionId,
        )
        if (staleAfterTabs) return staleAfterTabs
        const responseSessions = terminalSessionsWithWorkspaceTabOrder(sessions, createdSession?.worktreePath, tabs)
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
          sessions: responseSessions,
        }
      },
    )
  }

  private async rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoInstanceId'>,
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

function isTerminalCreateFailure(
  result: WorkspacePaneTabEntry[] | TerminalCreateFailure,
): result is TerminalCreateFailure {
  return !Array.isArray(result)
}

function terminalWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}

function terminalSessionsWithWorkspaceTabOrder(
  sessions: readonly TerminalSessionSummary[],
  worktreePath: string | null | undefined,
  tabs: readonly WorkspacePaneTabEntry[],
): TerminalSessionSummary[] {
  if (!worktreePath) return [...sessions]

  const sessionsById = new Map(sessions.map((session) => [session.terminalSessionId, session]))
  const usedSessionIds = new Set<string>()
  const orderedWorktreeSessions: TerminalSessionSummary[] = []

  for (const tab of tabs) {
    if (!isWorkspacePaneRuntimeTabEntry(tab) || tab.type !== 'terminal') continue
    const sessionId = workspacePaneRuntimeTabSessionId(tab)
    if (usedSessionIds.has(sessionId)) continue
    const session = sessionsById.get(sessionId)
    if (!session || session.worktreePath !== worktreePath) continue
    orderedWorktreeSessions.push(session)
    usedSessionIds.add(sessionId)
  }

  for (const session of sessions) {
    if (session.worktreePath !== worktreePath || usedSessionIds.has(session.terminalSessionId)) continue
    orderedWorktreeSessions.push(session)
    usedSessionIds.add(session.terminalSessionId)
  }

  let orderedWorktreeIndex = 0
  return sessions.map((session) => {
    if (session.worktreePath !== worktreePath) return session
    return orderedWorktreeSessions[orderedWorktreeIndex++] ?? session
  })
}
