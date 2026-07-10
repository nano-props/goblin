import type {
  TerminalCreateInput,
  TerminalCreateResult,
  TerminalSessionInput,
  TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabSessionId,
} from '#/shared/workspace-pane.ts'
import type {
  TerminalWorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeCommandTarget,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { terminalSessionRuntimeScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import { serverLogger } from '#/server/logger.ts'

type MaybePromise<T> = T | Promise<T>
const workspacePaneRuntimeApplicationLogger = serverLogger.child({ module: 'workspace-pane-runtime-application' })

interface WorkspacePaneRuntimeApplicationDependencies {
  workspaceTabsCoordinator: Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession' | 'reconcileWorktree'>
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  terminal: {
    create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult>
    close(clientId: string, userId: string, input: TerminalSessionInput): MaybePromise<boolean>
  }
  terminalWorktree: {
    listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  }
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
}

/**
 * Application operation joining provider lifecycle and workspace-pane
 * projection. All provider operations for one user/runtime/worktree share a
 * physical-worktree queue, so open and close observe one server-owned order
 * and cannot cross an admitted removal.
 */
export class WorkspacePaneRuntimeApplication {
  private readonly deps: WorkspacePaneRuntimeApplicationDependencies

  constructor(deps: WorkspacePaneRuntimeApplicationDependencies) {
    this.deps = deps
  }

  async open(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeOpenInput,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const scope = terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoRuntimeId)
    const worktreePath = terminalSessionWorktreePath(input.request.repoRoot, input.request.worktreePath)
    const operationTarget = { repoRoot: input.request.repoRoot, worktreePath }
    const result = await this.deps.worktreeOperations.runOperation(operationTarget, async (permit) => {
      switch (input.runtimeType) {
        case 'terminal':
          return await this.openTerminal(clientId, userId, input, scope, worktreePath, permit)
      }
    })
    return result.admitted ? result.value : runtimeFailure(input.runtimeType, 'error.worktree-removal-in-progress')
  }

  async close(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeCloseInput,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const target = normalizedRuntimeTarget(input.target)
    const scope = terminalSessionRuntimeScope(target.repoRoot, target.repoRuntimeId)
    const result = await this.deps.worktreeOperations.runOperation(
      { repoRoot: target.repoRoot, worktreePath: target.worktreePath },
      async () => {
        if (!this.isCurrentTarget(userId, target)) return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
        switch (input.runtimeType) {
          case 'terminal':
            return await this.closeTerminal(clientId, userId, target, input.sessionId, scope)
        }
      },
    )
    return result.admitted ? result.value : runtimeFailure(input.runtimeType, 'error.worktree-removal-in-progress')
  }

  private async openTerminal(
    clientId: string,
    userId: string,
    input: TerminalWorkspacePaneRuntimeOpenInput,
    scope: string,
    requestedWorktreePath: string,
    permit: PhysicalWorktreeOperationPermit,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const runtime = await this.deps.terminal.create(clientId, userId, input.request)
    if (!runtime.ok) return { ok: false, runtimeType: 'terminal', message: runtime.message }

    const session = runtime.sessions.find((candidate) => candidate.terminalSessionId === runtime.terminalSessionId)
    const staleFailure = runtimeFailure('terminal', 'error.repo-runtime-stale')
    const worktreePath = session?.worktreePath ?? requestedWorktreePath
    let workspacePaneTabs: WorkspacePaneTabsSnapshot | typeof staleFailure
    try {
      workspacePaneTabs = await this.deps.workspaceTabsCoordinator.ensureRuntimeTabForSession({
        userId,
        repoRoot: input.request.repoRoot,
        scope,
        branchName: session?.branch ?? input.request.branch,
        worktreePath,
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: input.insertAfterIdentity,
        permit,
        guardBeforeWrite: () =>
          this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId)
            ? null
            : staleFailure,
      })
    } catch (error) {
      const recovery = await this.recoverIncompleteTerminalOpen(clientId, userId, input, runtime, scope, worktreePath)
      workspacePaneRuntimeApplicationLogger.error(
        { error, ...recovery, userId, repoRoot: input.request.repoRoot, worktreePath },
        'terminal open application command failed',
      )
      return runtimeFailure('terminal', 'error.unavailable')
    }
    if (!isWorkspacePaneTabsSnapshot(workspacePaneTabs)) {
      const recovery = await this.recoverIncompleteTerminalOpen(clientId, userId, input, runtime, scope, worktreePath)
      if (recovery.closeError || recovery.reconcileError) {
        workspacePaneRuntimeApplicationLogger.error(
          { ...recovery, userId, repoRoot: input.request.repoRoot, worktreePath },
          'failed to recover rejected terminal open application command',
        )
      }
      return workspacePaneTabs
    }

    this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
    const targetTabs = tabsForTarget(workspacePaneTabs, session?.branch ?? input.request.branch, worktreePath)
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        ...runtime,
        sessions: terminalSessionsWithWorkspaceTabOrder(runtime.sessions, worktreePath, targetTabs),
      },
      workspacePaneTabs,
    }
  }

  private async recoverIncompleteTerminalOpen(
    clientId: string,
    userId: string,
    input: TerminalWorkspacePaneRuntimeOpenInput,
    runtime: Extract<TerminalCreateResult, { ok: true }>,
    scope: string,
    worktreePath: string,
  ): Promise<{ closeError: unknown; reconcileError: unknown }> {
    let closeError: unknown = null
    if (runtime.action === 'created') {
      try {
        const closed = await this.deps.terminal.close(clientId, userId, {
          terminalRuntimeSessionId: runtime.terminalRuntimeSessionId,
        })
        if (!closed) closeError = new Error('error.unavailable')
      } catch (caught) {
        closeError = caught
      }
    }
    let reconcileError: unknown = null
    try {
      await this.deps.workspaceTabsCoordinator.reconcileWorktree({
        userId,
        repoRoot: input.request.repoRoot,
        scope,
        worktreePath,
      })
    } catch (caught) {
      reconcileError = caught
    }
    this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
    return { closeError, reconcileError }
  }

  private async closeTerminal(
    clientId: string,
    userId: string,
    target: NormalizedRuntimeTarget,
    terminalSessionId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const sessions = await this.listTerminalSessions(userId, scope)
    const session = sessions.find(
      (candidate) =>
        candidate.terminalSessionId === terminalSessionId && candidate.worktreePath === target.worktreePath,
    )
    if (session) {
      const closed = await this.deps.terminal.close(clientId, userId, {
        terminalRuntimeSessionId: session.terminalRuntimeSessionId,
      })
      if (!closed) return runtimeFailure('terminal', 'error.unavailable')
    }
    const workspacePaneTabs = await this.reconcileTarget(userId, target, scope)
    const remainingSessions = await this.listTerminalSessions(userId, scope)
    return { ok: true, runtimeType: 'terminal', runtime: { sessions: remainingSessions }, workspacePaneTabs }
  }

  private async listTerminalSessions(userId: string, scope: string): Promise<TerminalSessionSummary[]> {
    return await this.deps.terminalWorktree.listSessionsForUser(userId, scope)
  }

  private async reconcileTarget(
    userId: string,
    target: NormalizedRuntimeTarget,
    scope: string,
  ): Promise<WorkspacePaneTabsSnapshot> {
    const snapshot = await this.deps.workspaceTabsCoordinator.reconcileWorktree({
      userId,
      repoRoot: target.repoRoot,
      scope,
      worktreePath: target.worktreePath,
    })
    this.deps.broadcastWorkspaceTabsChanged(userId, target.repoRoot)
    return snapshot
  }

  private isCurrentTarget(userId: string, target: WorkspacePaneRuntimeCommandTarget): boolean {
    return this.deps.isCurrentRepoRuntime(userId, target.repoRoot, target.repoRuntimeId)
  }
}

interface NormalizedRuntimeTarget extends WorkspacePaneRuntimeCommandTarget {
  worktreePath: string
}

function normalizedRuntimeTarget(target: WorkspacePaneRuntimeCommandTarget): NormalizedRuntimeTarget {
  if (target.worktreePath === null) throw new Error('error.invalid-arguments')
  return {
    ...target,
    worktreePath: terminalSessionWorktreePath(target.repoRoot, target.worktreePath),
  }
}

function runtimeFailure<TType extends 'terminal'>(runtimeType: TType, message: string) {
  return { ok: false as const, runtimeType, message }
}

function isWorkspacePaneTabsSnapshot(value: unknown): value is WorkspacePaneTabsSnapshot {
  return Boolean(value && typeof value === 'object' && 'revision' in value && 'entries' in value)
}

function tabsForTarget(snapshot: WorkspacePaneTabsSnapshot, branchName: string, worktreePath: string) {
  return (
    snapshot.entries.find((entry) => entry.branchName === branchName && entry.worktreePath === worktreePath)?.tabs ?? []
  )
}

function terminalSessionsWithWorkspaceTabOrder(
  sessions: readonly TerminalSessionSummary[],
  worktreePath: string,
  tabs: readonly WorkspacePaneTabEntry[],
): TerminalSessionSummary[] {
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

export function createWorkspacePaneRuntimeApplication(
  deps: WorkspacePaneRuntimeApplicationDependencies,
): WorkspacePaneRuntimeApplication {
  return new WorkspacePaneRuntimeApplication(deps)
}
