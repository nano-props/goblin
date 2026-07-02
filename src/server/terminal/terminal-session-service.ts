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
      ptySessionId: string
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
  closeSession(ptySessionId: string): void
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
  >
  broadcastSessionsChanged(userId: string, repoRoot: string): void
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
      const allocation = await this.allocateSessionIdForCreate(userId, input)
      const createResult = await this.ensureOrRestore(clientId, userId, {
        ...input,
        clientId: terminalClientId,
        terminalSessionId: allocation.terminalSessionId,
      }).finally(() => this.releaseSessionIdReservation(allocation))
      if (!createResult.ok) return { ok: false, message: createResult.message }
      const sessions = await this.listSessions(userId, input.repoRoot, input.repoInstanceId)
      const createdSession = sessions.find((session) => session.terminalSessionId === createResult.terminalSessionId)
      const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
      const tabs = createdSession
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
                  ),
                  liveTerminalSessionIds,
                ),
              })
            },
          )
        : []
      return {
        ok: true,
        action: createResult.action,
        terminalSessionId: createResult.terminalSessionId,
        tabs,
        ptySessionId: createResult.ptySessionId,
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
      const liveTerminalSessionIds =
        worktreePath === null ? [] : await this.liveTerminalSessionIdsForWorktree(userId, scope, worktreePath)
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
      const liveTerminalSessionIds =
        worktreePath === null ? [] : await this.liveTerminalSessionIdsForWorktree(userId, scope, worktreePath)
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
    await this.runWorkspaceTabsWorktreeOperation(userId, scope, session.worktreePath, async () => {
      const liveTerminalSessionIds = await this.liveTerminalSessionIdsForWorktree(
        userId,
        scope,
        session.worktreePath,
      )
      this.pruneWorkspaceTabsForWorktree({
        userId,
        scope,
        worktreePath: session.worktreePath,
        liveTerminalSessionIds,
      })
    })
  }

  async listWorkspaceTabs(userId: string, repoRoot: string, repoInstanceId: string): Promise<WorkspacePaneTabsEntry[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    const scope = terminalSessionRuntimeScope(repoRoot, repoInstanceId)
    const worktreePaths = new Set(
      this.options.workspaceTabs
        .tabsForScope({ userId, scope })
        .flatMap((entry) => (entry.worktreePath === null ? [] : [entry.worktreePath])),
    )
    for (const worktreePath of worktreePaths) {
      await this.runWorkspaceTabsWorktreeOperation(userId, scope, worktreePath, async () => {
        const liveTerminalSessionIds = await this.liveTerminalSessionIdsForWorktree(userId, scope, worktreePath)
        this.pruneWorkspaceTabsForWorktree({
          userId,
          scope,
          worktreePath,
          liveTerminalSessionIds,
        })
      })
    }
    return this.options.workspaceTabs.tabsForScope({ userId, scope }).map((entry) => ({
      repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: entry.tabs,
    }))
  }

  private applyWorkspacePaneTabsOperation(
    target: { userId: string; scope: string; branchName: string; worktreePath: string | null },
    operation: TerminalUpdateWorkspaceTabsOperation,
  ): WorkspacePaneTabEntry[] {
    switch (operation.type) {
      case 'open-static':
        return this.options.workspaceTabs.openStaticTab(target, operation.tabType, {
          insertAfterTabType: operation.insertAfterTabType,
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
      workspacePaneTabsUserQueueKey({ kind: 'worktree', userId, repoRoot: scope, worktreePath }),
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

  private pruneWorkspaceTabsForWorktree(input: {
    userId: string
    scope: string
    worktreePath: string
    liveTerminalSessionIds: readonly string[]
  }): void {
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
      this.options.workspaceTabs.replaceTabs({
        userId: input.userId,
        scope: input.scope,
        branchName: entry.branchName,
        worktreePath: entry.worktreePath,
        tabs: workspaceTabsWithoutStaleTerminalEntries(currentTabs, input.liveTerminalSessionIds),
      })
    }
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
    const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
    let pruned = 0
    for (const session of allSessions) {
      if (path.resolve(session.repoRoot) !== path.resolve(repoRoot)) continue
      if (liveWorktreePaths.has(path.resolve(session.worktreePath))) continue
      this.options.manager.closeSession(session.ptySessionId)
      pruned += 1
    }
    const remaining = await this.options.manager
      .listSessionsForUser(userId, sessionScope)
      .then((sessions) => sessions.length)
    return { pruned, remaining }
  }

  private async liveTerminalSessionIdsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<string[]> {
    const sessions = await this.options.manager.listSessionsForUser(userId, scope)
    return sessions
      .filter((session) => session.worktreePath === worktreePath)
      .map((session) => session.terminalSessionId)
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

function toEnsureResult(
  terminalSessionId: string,
  action: TerminalCreateAction,
  snapshotResult: Extract<TerminalAttachResult, { ok: true }>,
): EnsureTerminalSessionResult {
  return {
    ok: true,
    ptySessionId: snapshotResult.ptySessionId,
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

function isValidWorkspacePaneTabsOperation(value: unknown): value is TerminalUpdateWorkspaceTabsOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as {
    type?: unknown
    tabType?: unknown
    tabIdentities?: unknown
    insertAfterTabType?: unknown
  }
  if (operation.type === 'open-static') {
    return (
      typeof operation.tabType === 'string' &&
      isWorkspacePaneStaticTabType(operation.tabType) &&
      (operation.insertAfterTabType === undefined ||
        operation.insertAfterTabType === null ||
        (typeof operation.insertAfterTabType === 'string' && isWorkspacePaneStaticTabType(operation.insertAfterTabType)))
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
