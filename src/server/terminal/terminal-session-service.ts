import path from 'node:path'
import PQueue from 'p-queue'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  type TerminalAttachResult,
  type TerminalCreateAction,
  type TerminalCreateResult,
  type TerminalControllerStatus,
  type TerminalCreateInput,
  type TerminalSessionPhase,
  type TerminalSessionSummary,
  type TerminalUpdateWorkspaceTabsInput,
  type TerminalUpdateWorkspaceTabsOperation,
  type WorkspacePaneTabsEntry,
} from '#/shared/terminal-types.ts'
import {
  isWorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabsUserQueueKey,
  workspacePaneTabsUserQueueTarget,
} from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import { isValidTerminalClientId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import {
  buildGoblinTerminalCommandEnvironment,
  type GoblinTerminalCommandRuntime,
} from '#/server/terminal/g-command.ts'
import { terminalSessionUserWorktreeKey } from '#/shared/terminal-session-keys.ts'
import type { WorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'

interface EnsureTerminalSessionInput {
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
  terminalSessionId?: string
  startupShellCommand?: string
  cols?: number
  rows?: number
  clientId?: string
}

// Internal-only shape for the service's ensure/restore result. The wire
// contract is `TerminalCreateResult`; this richer payload is used to ferry
// attach metadata between private helpers. Do not export.
type EnsureTerminalSessionResult =
  | {
      ok: true
      terminalRuntimeSessionId: string
      terminalSessionId: string
      action: TerminalCreateAction
      processName: string
      canonicalTitle: string | null
      phase: TerminalSessionPhase
      message: string | null
      snapshot: string
      snapshotSeq: number
      controller: { clientId: string; status: Exclude<TerminalControllerStatus, 'none'> } | null
      canonicalCols: number
      canonicalRows: number
    }
  | { ok: false; message: string }

interface TerminalServiceEnsureSessionInput {
  userId: string
  scope: string
  repoRoot: string
  repoInstanceId: string
  branch: string
  terminalSessionId: string
  worktreePath: string
  cwd: string
  cols: number
  rows: number
  clientId?: string
  command?: string
  args?: string[]
  startupShellCommand?: string
  env?: Record<string, string>
}

interface TerminalSessionServiceManager {
  ensureSession(input: TerminalServiceEnsureSessionInput): Promise<TerminalAttachResult>
  listSessionsForUser(userId: string, repoRoot: string): Promise<TerminalSessionSummary[]>
  closeSession(terminalRuntimeSessionId: string): void
}

interface TerminalSessionServiceOptions {
  isValidClientId(value: unknown): value is string
  isValidTerminalSessionId(value: unknown): value is string
  manager: TerminalSessionServiceManager
  workspaceTabs: Pick<
    WorkspacePaneTabsRuntime<string>,
    | 'closeStaticTab'
    | 'ensureTerminalTab'
    | 'openStaticTab'
    | 'reorderTabsByIdentity'
    | 'replaceTabs'
    | 'tabs'
    | 'tabsForScope'
    | 'closeSessionsForScope'
  >
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
  isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean
  gCommand?: GoblinTerminalCommandRuntime
}

interface TerminalSessionIdAllocation {
  terminalSessionId: string
  reservationKey: string | null
}

class TerminalSessionService {
  private readonly options: TerminalSessionServiceOptions
  private readonly createQueuesByUserWorktree = new Map<string, PQueue>()
  private readonly workspaceTabOperationQueuesByTarget = new Map<string, PQueue>()
  private readonly reservedTerminalSessionIdsByWorktree = new Map<string, Set<string>>()

  constructor(options: TerminalSessionServiceOptions) {
    this.options = options
  }

  async ensureOrRestore(
    clientId: string,
    userId: string,
    input: EnsureTerminalSessionInput,
  ): Promise<EnsureTerminalSessionResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }

    const terminalSessionId = input.terminalSessionId ?? createTerminalSessionId()
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    if (!this.options.isValidTerminalSessionId(terminalSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalSize(cols, rows)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const scopedWorktreePath = terminalWorktreePath(input.repoRoot, input.worktreePath)
    const existingSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    const existingSession = existingSessions.find(
      (session) => session.terminalSessionId === terminalSessionId && session.worktreePath === scopedWorktreePath,
    )
    const action: TerminalCreateAction = existingSession
      ? existingSession.controller
        ? 'restored'
        : 'reused'
      : 'created'

    if (isRemoteRepoId(input.repoRoot)) {
      return await this.ensureRemote(userId, input, {
        terminalSessionId,
        cols,
        rows,
        scopedWorktreePath,
        action,
      })
    }
    return await this.ensureLocal(userId, input, { terminalSessionId, cols, rows, scopedWorktreePath, action })
  }

  async create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
    const terminalClientId = input.clientId ?? clientId
    if (!isValidTerminalClientId(terminalClientId)) return { ok: false, message: 'error.invalid-arguments' }

    return await this.runCreateInWorktreeQueue(userId, input, async () => {
      if (!this.isCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)) {
        return { ok: false, message: 'error.repo-instance-stale' }
      }
      const allocation = await this.allocateSessionIdForCreate(userId, input)
      const createResult = await this.ensureOrRestore(clientId, userId, {
        ...input,
        clientId: terminalClientId,
        terminalSessionId: allocation.terminalSessionId,
      }).finally(() => this.releaseSessionIdReservation(allocation))
      if (!createResult.ok) return { ok: false, message: createResult.message }
      const staleAfterEnsure = this.rejectStaleCreateIfNeeded(userId, input, createResult.terminalRuntimeSessionId)
      if (staleAfterEnsure) return staleAfterEnsure
      const sessions = await this.listSessions(userId, input.repoRoot, input.repoInstanceId)
      const staleAfterList = this.rejectStaleCreateIfNeeded(userId, input, createResult.terminalRuntimeSessionId)
      if (staleAfterList) return staleAfterList
      const createdSession = sessions.find((session) => session.terminalSessionId === createResult.terminalSessionId)
      const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
      const tabsResult = createdSession
        ? await this.runWorkspaceTabsOperation(
            userId,
            sessionScope,
            input.branch,
            createdSession.worktreePath,
            async () => {
              const liveTerminalSessionIds = await this.liveTerminalSessionIdsForWorktree(
                userId,
                sessionScope,
                createdSession.worktreePath,
              )
              const staleAfterLiveLookup = this.rejectStaleCreateIfNeeded(
                userId,
                input,
                createResult.terminalRuntimeSessionId,
              )
              if (staleAfterLiveLookup) return staleAfterLiveLookup
              return this.options.workspaceTabs.replaceTabs({
                userId,
                scope: sessionScope,
                branchName: input.branch,
                worktreePath: createdSession.worktreePath,
                tabs: workspaceTabsWithoutStaleTerminalEntries(
                  this.options.workspaceTabs.ensureTerminalTab(
                    {
                      userId,
                      scope: sessionScope,
                      branchName: input.branch,
                      worktreePath: createdSession.worktreePath,
                    },
                    createResult.terminalSessionId,
                    { insertAfterIdentity: input.insertAfterIdentity ?? null },
                  ),
                  liveTerminalSessionIds,
                ),
              })
            },
          )
        : []
      if (isTerminalCreateFailure(tabsResult)) return tabsResult
      const tabs = tabsResult
      const staleAfterTabs = this.rejectStaleCreateIfNeeded(userId, input, createResult.terminalRuntimeSessionId)
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
        controller: createResult.controller,
        canonicalCols: createResult.canonicalCols,
        canonicalRows: createResult.canonicalRows,
        sessions,
      }
    })
  }

  async replaceTabs(
    userId: string,
    input: {
      repoRoot: string
      repoInstanceId: string
      branchName: string
      worktreePath: string | null
      tabs: readonly WorkspacePaneTabEntry[]
    },
  ): Promise<WorkspacePaneTabEntry[]> {
    if (!isValidRepoLocator(input.repoRoot)) return []
    if (!isValidBranch(input.branchName)) return []
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return []
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const worktreePath = input.worktreePath === null ? null : terminalWorktreePath(input.repoRoot, input.worktreePath)
    return await this.runWorkspaceTabsOperation(userId, scope, input.branchName, worktreePath, async () => {
      this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      const liveTerminalSessionIds =
        worktreePath === null ? [] : await this.liveTerminalSessionIdsForWorktree(userId, scope, worktreePath)
      this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      return this.options.workspaceTabs.replaceTabs({
        userId,
        scope,
        branchName: input.branchName,
        worktreePath,
        tabs: workspaceTabsWithoutStaleTerminalEntries(input.tabs, liveTerminalSessionIds),
      })
    })
  }

  async updateTabs(userId: string, input: TerminalUpdateWorkspaceTabsInput): Promise<WorkspacePaneTabEntry[]> {
    if (!isValidRepoLocator(input.repoRoot)) return []
    if (!isValidBranch(input.branchName)) return []
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return []
    if (!isValidWorkspacePaneTabsOperation(input.operation)) return []
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const worktreePath = input.worktreePath === null ? null : terminalWorktreePath(input.repoRoot, input.worktreePath)
    return await this.runWorkspaceTabsOperation(userId, scope, input.branchName, worktreePath, async () => {
      this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      const liveTerminalSessionIds =
        worktreePath === null ? [] : await this.liveTerminalSessionIdsForWorktree(userId, scope, worktreePath)
      this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      const target = { userId, scope, branchName: input.branchName, worktreePath }
      const updatedTabs = this.applyWorkspacePaneTabsOperation(target, input.operation)
      return this.options.workspaceTabs.replaceTabs({
        ...target,
        tabs: workspaceTabsWithoutStaleTerminalEntries(updatedTabs, liveTerminalSessionIds),
      })
    })
  }

  async reconcileTerminalTabsForSession(userId: string, session: TerminalSessionSummary): Promise<void> {
    const scope = terminalSessionRuntimeScope(session.repoRoot, session.repoInstanceId)
    await this.projectWorkspaceTerminalTabsForWorktree(userId, scope, session.worktreePath)
  }

  async listWorkspaceTabs(userId: string, repoRoot: string, repoInstanceId: string): Promise<WorkspacePaneTabsEntry[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    const scope = terminalSessionRuntimeScope(repoRoot, repoInstanceId)
    const liveSessions = await this.options.manager.listSessionsForUser(userId, scope)
    const worktreePaths = new Set(
      this.options.workspaceTabs
        .tabsForScope({ userId, scope })
        .flatMap((entry) => (entry.worktreePath === null ? [] : [entry.worktreePath])),
    )
    for (const session of liveSessions) worktreePaths.add(session.worktreePath)
    let changed = false
    // Read-side canonicalization boundary: workspace pane terminal tabs are a
    // projection of live terminal sessions. Listing tabs self-heals missing
    // terminal entries so reload/restore always returns a coherent tab strip.
    for (const worktreePath of worktreePaths) {
      changed = (await this.projectWorkspaceTerminalTabsForWorktree(userId, scope, worktreePath)) || changed
    }
    if (changed) this.options.broadcastWorkspaceTabsChanged(userId, repoRoot)
    return this.options.workspaceTabs.tabsForScope({ userId, scope }).map((entry) => ({
      repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: entry.tabs,
    }))
  }

  private async projectWorkspaceTerminalTabsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<boolean> {
    return await this.runWorkspaceTabsWorktreeOperation(userId, scope, worktreePath, async () => {
      const liveSessions = await this.liveTerminalSessionsForWorktree(userId, scope, worktreePath)
      const liveTerminalSessionIds = liveSessions.map((session) => session.terminalSessionId)
      const pruned = this.pruneWorkspaceTabsForWorktree({
        userId,
        scope,
        worktreePath,
        liveTerminalSessionIds,
      })
      const materialized = this.ensureWorkspaceTerminalTabsForLiveSessions({
        userId,
        scope,
        worktreePath,
        liveSessions,
      })
      return pruned || materialized
    })
  }

  private ensureWorkspaceTerminalTabsForLiveSessions(input: {
    userId: string
    scope: string
    worktreePath: string
    liveSessions: readonly TerminalSessionSummary[]
  }): boolean {
    if (input.liveSessions.length === 0) return false
    const branchName =
      this.options.workspaceTabs
        .tabsForScope({ userId: input.userId, scope: input.scope })
        .find((entry) => entry.worktreePath === input.worktreePath)?.branchName ??
      input.liveSessions[0]?.branch ??
      null
    if (!branchName) return false

    const currentTabs = this.options.workspaceTabs.tabs({
      userId: input.userId,
      scope: input.scope,
      branchName,
      worktreePath: input.worktreePath,
    })
    const missingTerminalSessionIds = input.liveSessions
      .map((session) => session.terminalSessionId)
      .filter(
        (terminalSessionId) =>
          !currentTabs.some((entry) => entry.type === 'terminal' && entry.terminalSessionId === terminalSessionId),
      )
    if (missingTerminalSessionIds.length === 0) return false
    this.options.workspaceTabs.replaceTabs({
      userId: input.userId,
      scope: input.scope,
      branchName,
      worktreePath: input.worktreePath,
      tabs: [
        ...currentTabs,
        ...missingTerminalSessionIds.map((terminalSessionId) => workspacePaneTerminalTabEntry(terminalSessionId)),
      ],
    })
    return true
  }

  private pruneWorkspaceTabsForWorktree(input: {
    userId: string
    scope: string
    worktreePath: string
    liveTerminalSessionIds: readonly string[]
  }): boolean {
    let changed = false
    const entries = this.options.workspaceTabs
      .tabsForScope({ userId: input.userId, scope: input.scope })
      .filter((entry) => entry.worktreePath === input.worktreePath)
    for (const entry of entries) {
      const currentTabs = this.options.workspaceTabs.tabs({
        userId: input.userId,
        scope: input.scope,
        branchName: entry.branchName,
        worktreePath: entry.worktreePath,
      })
      const nextTabs = workspaceTabsWithoutStaleTerminalEntries(currentTabs, input.liveTerminalSessionIds)
      if (workspacePaneTabEntryArraysEqual(currentTabs, nextTabs)) continue
      this.options.workspaceTabs.replaceTabs({
        userId: input.userId,
        scope: input.scope,
        branchName: entry.branchName,
        worktreePath: entry.worktreePath,
        tabs: nextTabs,
      })
      changed = true
    }
    return changed
  }

  private applyWorkspacePaneTabsOperation(
    target: { userId: string; scope: string; branchName: string; worktreePath: string | null },
    operation: TerminalUpdateWorkspaceTabsOperation,
  ): WorkspacePaneTabEntry[] {
    switch (operation.type) {
      case 'open-static':
        return this.options.workspaceTabs.openStaticTab(target, operation.tabType, {
          insertAfterIdentity: operation.insertAfterIdentity,
        })
      case 'close-static':
        return this.options.workspaceTabs.closeStaticTab(target, operation.tabType)
      case 'reorder':
        return this.options.workspaceTabs.reorderTabsByIdentity(target, operation.tabIdentities)
    }
  }

  private async runWorkspaceTabsOperation<T>(
    userId: string,
    scope: string,
    branchName: string,
    worktreePath: string | null,
    task: () => Promise<T> | T,
  ): Promise<T> {
    return await this.runWorkspaceTabsOperationByKey(
      workspacePaneTabsUserQueueKey(workspacePaneTabsUserQueueTarget(userId, scope, branchName, worktreePath)),
      task,
    )
  }

  private async runWorkspaceTabsWorktreeOperation<T>(
    userId: string,
    scope: string,
    worktreePath: string,
    task: () => Promise<T> | T,
  ): Promise<T> {
    return await this.runWorkspaceTabsOperationByKey(
      workspacePaneTabsUserQueueKey({ kind: 'worktree', userId, scope, worktreePath }),
      task,
    )
  }

  private async runWorkspaceTabsOperationByKey<T>(queueKey: string, task: () => Promise<T> | T): Promise<T> {
    const queue = this.workspaceTabsOperationQueue(queueKey)
    try {
      return await queue.add(task)
    } finally {
      this.scheduleWorkspaceTabsOperationQueueCleanup(queueKey, queue)
    }
  }

  private workspaceTabsOperationQueue(queueKey: string): PQueue {
    let queue = this.workspaceTabOperationQueuesByTarget.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.workspaceTabOperationQueuesByTarget.set(queueKey, queue)
    }
    return queue
  }

  private scheduleWorkspaceTabsOperationQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.workspaceTabOperationQueuesByTarget.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.workspaceTabOperationQueuesByTarget.delete(queueKey)
    })
  }

  private async runCreateInWorktreeQueue<T>(
    userId: string,
    input: TerminalCreateInput,
    task: () => Promise<T>,
  ): Promise<T> {
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const queueKey = terminalSessionUserWorktreeKey({
      userId,
      scope,
      worktreePath: terminalWorktreePath(input.repoRoot, input.worktreePath),
    })
    const queue = this.createQueueForUserWorktree(queueKey)
    try {
      return await queue.add(task)
    } finally {
      this.scheduleCreateQueueCleanup(queueKey, queue)
    }
  }

  private createQueueForUserWorktree(queueKey: string): PQueue {
    let queue = this.createQueuesByUserWorktree.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.createQueuesByUserWorktree.set(queueKey, queue)
    }
    return queue
  }

  private scheduleCreateQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.createQueuesByUserWorktree.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.createQueuesByUserWorktree.delete(queueKey)
    })
  }

  async listSessions(userId: string, repoRoot: string, repoInstanceId: string): Promise<TerminalSessionSummary[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    return await this.options.manager.listSessionsForUser(userId, terminalSessionRuntimeScope(repoRoot, repoInstanceId))
  }

  async prune(
    clientId: string,
    userId: string,
    repoRoot: string,
    repoInstanceId: string,
  ): Promise<{ pruned: number; remaining: number }> {
    if (!this.options.isValidClientId(clientId)) return { pruned: 0, remaining: 0 }
    if (!isValidRepoLocator(repoRoot)) return { pruned: 0, remaining: 0 }

    const sessionScope = terminalSessionRuntimeScope(repoRoot, repoInstanceId)
    const allSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    if (isRemoteRepoId(repoRoot)) return { pruned: 0, remaining: allSessions.length }

    const worktrees = await getWorktrees(repoRoot, { includeStatus: false })
    this.assertCurrentRepoInstance(userId, repoRoot, repoInstanceId)
    const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
    let pruned = 0
    for (const session of allSessions) {
      if (path.resolve(session.repoRoot) !== path.resolve(repoRoot)) continue
      if (liveWorktreePaths.has(path.resolve(session.worktreePath))) continue
      this.options.manager.closeSession(session.terminalRuntimeSessionId)
      pruned += 1
    }
    const remaining = await this.options.manager
      .listSessionsForUser(userId, sessionScope)
      .then((sessions) => sessions.length)
    return { pruned, remaining }
  }

  private isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean {
    return this.options.isCurrentRepoInstance(userId, repoRoot, repoInstanceId)
  }

  private assertCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): void {
    if (!this.isCurrentRepoInstance(userId, repoRoot, repoInstanceId)) throw new Error('error.repo-instance-stale')
  }

  private rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoInstanceId'>,
    terminalRuntimeSessionId: string,
  ): Extract<TerminalCreateResult, { ok: false }> | null {
    if (this.isCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)) return null
    this.options.manager.closeSession(terminalRuntimeSessionId)
    this.options.workspaceTabs.closeSessionsForScope(userId, terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId))
    return { ok: false, message: 'error.repo-instance-stale' }
  }

  private async liveTerminalSessionIdsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<string[]> {
    return (await this.liveTerminalSessionsForWorktree(userId, scope, worktreePath)).map(
      (session) => session.terminalSessionId,
    )
  }

  private async liveTerminalSessionsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<TerminalSessionSummary[]> {
    const sessions = await this.options.manager.listSessionsForUser(userId, scope)
    return sessions.filter((session) => session.worktreePath === worktreePath)
  }

  private async allocateSessionIdForCreate(
    userId: string,
    input: TerminalCreateInput,
  ): Promise<TerminalSessionIdAllocation> {
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const worktreePath = terminalWorktreePath(input.repoRoot, input.worktreePath)
    const sessions = await this.options.manager.listSessionsForUser(userId, scope)
    const existingSession = sessions.find((session) => session.worktreePath === worktreePath)
    if (input.kind === 'primary' && existingSession) {
      return { terminalSessionId: existingSession.terminalSessionId, reservationKey: null }
    }
    const reservationKey = terminalSessionUserWorktreeKey({ userId, scope, worktreePath })
    const reservedTerminalSessionId = this.reservedTerminalSessionIdsByWorktree
      .get(reservationKey)
      ?.values()
      .next().value
    if (input.kind === 'primary' && reservedTerminalSessionId)
      return { terminalSessionId: reservedTerminalSessionId, reservationKey: null }
    return { terminalSessionId: this.reserveNewSessionId(reservationKey), reservationKey }
  }

  private reserveNewSessionId(reservationKey: string): string {
    let reserved = this.reservedTerminalSessionIdsByWorktree.get(reservationKey)
    if (!reserved) {
      reserved = new Set()
      this.reservedTerminalSessionIdsByWorktree.set(reservationKey, reserved)
    }
    const terminalSessionId = createTerminalSessionId()
    reserved.add(terminalSessionId)
    return terminalSessionId
  }

  private releaseSessionIdReservation(allocation: TerminalSessionIdAllocation): void {
    if (!allocation.reservationKey) return
    const reserved = this.reservedTerminalSessionIdsByWorktree.get(allocation.reservationKey)
    if (!reserved) return
    reserved.delete(allocation.terminalSessionId)
    if (reserved.size === 0) this.reservedTerminalSessionIdsByWorktree.delete(allocation.reservationKey)
  }

  private async ensureRemote(
    userId: string,
    input: EnsureTerminalSessionInput,
    context: {
      terminalSessionId: string
      cols: number
      rows: number
      scopedWorktreePath: string
      action: TerminalCreateAction
    },
  ): Promise<EnsureTerminalSessionResult> {
    const ref = parseRemoteRepoId(input.repoRoot)
    if (!ref) return { ok: false, message: 'error.ssh-config-changed' }
    let resolved
    try {
      resolved = await resolveRemoteTarget(ref)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'error.ssh-config-changed' }
    }
    const invocation = buildRemoteTerminalInvocation(
      resolved.target,
      input.worktreePath,
      {
        cols: context.cols,
        rows: context.rows,
      },
      { startupShellCommand: input.startupShellCommand },
    )
    const result = await this.options.manager.ensureSession({
      userId,
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId),
      repoRoot: input.repoRoot,
      repoInstanceId: input.repoInstanceId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: context.scopedWorktreePath,
      cwd: process.cwd(),
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      command: invocation.command,
      args: invocation.args,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.terminalSessionId, context.action, result)
  }

  private async ensureLocal(
    userId: string,
    input: EnsureTerminalSessionInput,
    context: {
      terminalSessionId: string
      cols: number
      rows: number
      scopedWorktreePath: string
      action: TerminalCreateAction
    },
  ): Promise<EnsureTerminalSessionResult> {
    const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
    const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
    if (!resolved.ok) return { ok: false, message: resolved.message }

    const repoRoot = path.resolve(input.repoRoot)
    const worktreePath = path.resolve(resolved.path)
    const env = this.options.gCommand
      ? (buildGoblinTerminalCommandEnvironment({
          ...this.options.gCommand,
          repoRoot,
          worktreePath,
        }) ?? undefined)
      : undefined
    const result = await this.options.manager.ensureSession({
      userId,
      scope: terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId),
      repoRoot,
      repoInstanceId: input.repoInstanceId,
      branch: input.branch,
      terminalSessionId: context.terminalSessionId,
      worktreePath: worktreePath,
      cwd: worktreePath,
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      startupShellCommand: input.startupShellCommand,
      env,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.terminalSessionId, context.action, result)
  }
}

function isTerminalCreateFailure(
  result: WorkspacePaneTabEntry[] | Extract<TerminalCreateResult, { ok: false }>,
): result is Extract<TerminalCreateResult, { ok: false }> {
  return !Array.isArray(result)
}

function toEnsureResult(
  terminalSessionId: string,
  action: TerminalCreateAction,
  snapshotResult: Extract<TerminalAttachResult, { ok: true }>,
): EnsureTerminalSessionResult {
  return {
    ok: true,
    terminalRuntimeSessionId: snapshotResult.terminalRuntimeSessionId,
    terminalSessionId,
    action,
    processName: snapshotResult.processName,
    canonicalTitle: snapshotResult.canonicalTitle,
    phase: snapshotResult.phase,
    message: snapshotResult.message,
    snapshot: snapshotResult.snapshot,
    snapshotSeq: snapshotResult.snapshotSeq,
    controller: snapshotResult.controller,
    canonicalCols: snapshotResult.canonicalCols,
    canonicalRows: snapshotResult.canonicalRows,
  }
}

export function createTerminalSessionService(options: TerminalSessionServiceOptions): TerminalSessionService {
  return new TerminalSessionService(options)
}

function terminalWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}

function workspaceTabsWithoutStaleTerminalEntries(
  tabs: readonly WorkspacePaneTabEntry[],
  liveTerminalSessionIds: readonly string[],
): WorkspacePaneTabEntry[] {
  const liveTerminalSessionIdsSet = new Set(
    liveTerminalSessionIds.filter((terminalSessionId) => terminalSessionId.length > 0),
  )
  const seen = new Set<string>()
  const next: WorkspacePaneTabEntry[] = []
  for (const entry of tabs) {
    if (entry.type === 'terminal') {
      if (!liveTerminalSessionIdsSet.has(entry.terminalSessionId)) continue
    }
    const identity = workspacePaneTabEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}

function workspacePaneTabEntryArraysEqual(
  a: readonly WorkspacePaneTabEntry[],
  b: readonly WorkspacePaneTabEntry[],
): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const current = a[index]
    const next = b[index]
    if (!current || !next) return false
    if (workspacePaneTabEntryIdentity(current) !== workspacePaneTabEntryIdentity(next)) return false
  }
  return true
}

function isValidWorkspacePaneTabsOperation(value: unknown): value is TerminalUpdateWorkspaceTabsOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as {
    type?: unknown
    tabType?: unknown
    tabIdentities?: unknown
    insertAfterIdentity?: unknown
  }
  if (operation.type === 'open-static') {
    return (
      typeof operation.tabType === 'string' &&
      isWorkspacePaneStaticTabType(operation.tabType) &&
      (operation.insertAfterIdentity === undefined ||
        operation.insertAfterIdentity === null ||
        (typeof operation.insertAfterIdentity === 'string' &&
          operation.insertAfterIdentity.length > 0 &&
          !operation.insertAfterIdentity.includes('\0')))
    )
  }
  if (operation.type === 'close-static') {
    return typeof operation.tabType === 'string' && isWorkspacePaneStaticTabType(operation.tabType)
  }
  if (operation.type === 'reorder') {
    return (
      Array.isArray(operation.tabIdentities) &&
      operation.tabIdentities.every(
        (identity) => typeof identity === 'string' && identity.length > 0 && !identity.includes('\0'),
      )
    )
  }
  return false
}
