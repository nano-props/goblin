import PQueue from 'p-queue'
import type {
  TerminalSessionSummary,
  TerminalUpdateWorkspaceTabsOperation,
  WorkspacePaneTabsEntry,
} from '#/shared/terminal-types.ts'
import { isWorkspacePaneStaticTabType, type WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabsUserQueueKey,
  workspacePaneTabsUserQueueTarget,
} from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import type { WorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import {
  projectWorkspaceTerminalTabsForWorktree,
  workspaceTabsWithoutStaleTerminalEntries,
} from '#/server/terminal/terminal-workspace-tabs-projection.ts'

type TerminalWorkspaceTabsRuntime = Pick<
  WorkspacePaneTabsRuntime<string>,
  'closeStaticTab' | 'ensureTerminalTab' | 'openStaticTab' | 'reorderTabsByIdentity' | 'replaceTabs' | 'tabsForScope'
>

interface TerminalWorkspaceTabsManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
}

interface TerminalWorkspaceTabsCoordinatorOptions {
  manager: TerminalWorkspaceTabsManager
  workspaceTabs: TerminalWorkspaceTabsRuntime
}

interface TerminalWorkspaceTabsTarget {
  userId: string
  scope: string
  branchName: string
  worktreePath: string | null
}

class TerminalWorkspaceTabsCoordinator {
  private readonly manager: TerminalWorkspaceTabsManager
  private readonly workspaceTabs: TerminalWorkspaceTabsRuntime
  private readonly operationQueuesByTarget = new Map<string, PQueue>()

  constructor(options: TerminalWorkspaceTabsCoordinatorOptions) {
    this.manager = options.manager
    this.workspaceTabs = options.workspaceTabs
  }

  async ensureTerminalTabForSession<TFailure>(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string
    terminalSessionId: string
    insertAfterIdentity?: string | null
    guardBeforeWrite?: () => TFailure | null
  }): Promise<WorkspacePaneTabEntry[] | TFailure> {
    const target = {
      userId: input.userId,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    }
    return await this.runWorkspaceTabsOperation(
      input.userId,
      input.scope,
      input.branchName,
      input.worktreePath,
      async () => {
        const liveTerminalSessionIds = await this.liveTerminalSessionIdsForWorktree(
          input.userId,
          input.scope,
          input.worktreePath,
        )
        const failure = input.guardBeforeWrite?.() ?? null
        if (failure) return failure
        const tabs = this.workspaceTabs.ensureTerminalTab(target, input.terminalSessionId, {
          insertAfterIdentity: input.insertAfterIdentity ?? null,
        })
        return this.workspaceTabs.replaceTabs({
          ...target,
          tabs: workspaceTabsWithoutStaleTerminalEntries(tabs, liveTerminalSessionIds),
        })
      },
    )
  }

  async replaceTabs(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabEntry[]> {
    return await this.runWorkspaceTabsOperation(
      input.userId,
      input.scope,
      input.branchName,
      input.worktreePath,
      async () => {
        input.assertCurrent()
        const liveTerminalSessionIds =
          input.worktreePath === null
            ? []
            : await this.liveTerminalSessionIdsForWorktree(input.userId, input.scope, input.worktreePath)
        input.assertCurrent()
        return this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          tabs: workspaceTabsWithoutStaleTerminalEntries(input.tabs, liveTerminalSessionIds),
        })
      },
    )
  }

  async updateTabs(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string | null
    operation: TerminalUpdateWorkspaceTabsOperation
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabEntry[]> {
    return await this.runWorkspaceTabsOperation(
      input.userId,
      input.scope,
      input.branchName,
      input.worktreePath,
      async () => {
        input.assertCurrent()
        const liveTerminalSessionIds =
          input.worktreePath === null
            ? []
            : await this.liveTerminalSessionIdsForWorktree(input.userId, input.scope, input.worktreePath)
        input.assertCurrent()
        const target = {
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
        }
        const updatedTabs = this.applyWorkspacePaneTabsOperation(target, input.operation)
        return this.workspaceTabs.replaceTabs({
          ...target,
          tabs: workspaceTabsWithoutStaleTerminalEntries(updatedTabs, liveTerminalSessionIds),
        })
      },
    )
  }

  async reconcileWorktree(input: {
    userId: string
    scope: string
    worktreePath: string
    assertCurrent?: () => void
  }): Promise<boolean> {
    return await this.runWorkspaceTabsWorktreeOperation(input.userId, input.scope, input.worktreePath, async () => {
      const liveSessions = await this.liveTerminalSessionsForWorktree(input.userId, input.scope, input.worktreePath)
      input.assertCurrent?.()
      const entries = this.workspaceTabs
        .tabsForScope({ userId: input.userId, scope: input.scope })
        .filter((entry) => entry.worktreePath === input.worktreePath)
      const replacements = projectWorkspaceTerminalTabsForWorktree({
        entries,
        worktreePath: input.worktreePath,
        liveSessions,
      })
      for (const replacement of replacements) {
        this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: replacement.branchName,
          worktreePath: replacement.worktreePath,
          tabs: replacement.tabs,
        })
      }
      return replacements.length > 0
    })
  }

  async listWorkspaceTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
    broadcastChanged: () => void
  }): Promise<WorkspacePaneTabsEntry[]> {
    await this.reconcileWorkspaceTabsProjectionBoundary(input)
    return this.workspaceTabs.tabsForScope({ userId: input.userId, scope: input.scope }).map((entry) => ({
      repoRoot: input.repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: entry.tabs,
    }))
  }

  private async reconcileWorkspaceTabsProjectionBoundary(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
    broadcastChanged: () => void
  }): Promise<void> {
    const liveSessions = await this.manager.listSessionsForUser(input.userId, input.scope)
    input.assertCurrent()
    const worktreePaths = new Set(
      this.workspaceTabs
        .tabsForScope({ userId: input.userId, scope: input.scope })
        .flatMap((entry) => (entry.worktreePath === null ? [] : [entry.worktreePath])),
    )
    for (const session of liveSessions) worktreePaths.add(session.worktreePath)
    let changed = false
    // Read-side canonicalization boundary: workspace pane terminal tabs are a
    // projection of live terminal sessions. Listing tabs self-heals missing
    // terminal entries so reload/restore always returns a coherent tab strip.
    for (const worktreePath of worktreePaths) {
      input.assertCurrent()
      changed =
        (await this.reconcileWorktree({
          userId: input.userId,
          scope: input.scope,
          worktreePath,
          assertCurrent: input.assertCurrent,
        })) || changed
      input.assertCurrent()
    }
    if (changed) input.broadcastChanged()
  }

  private applyWorkspacePaneTabsOperation(
    target: TerminalWorkspaceTabsTarget,
    operation: TerminalUpdateWorkspaceTabsOperation,
  ): WorkspacePaneTabEntry[] {
    switch (operation.type) {
      case 'open-static':
        return this.workspaceTabs.openStaticTab(target, operation.tabType, {
          insertAfterIdentity: operation.insertAfterIdentity,
        })
      case 'close-static':
        return this.workspaceTabs.closeStaticTab(target, operation.tabType)
      case 'reorder':
        return this.workspaceTabs.reorderTabsByIdentity(target, operation.tabIdentities)
    }
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
    const sessions = await this.manager.listSessionsForUser(userId, scope)
    return sessions.filter((session) => session.worktreePath === worktreePath)
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
    let queue = this.operationQueuesByTarget.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.operationQueuesByTarget.set(queueKey, queue)
    }
    return queue
  }

  private scheduleWorkspaceTabsOperationQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.operationQueuesByTarget.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.operationQueuesByTarget.delete(queueKey)
    })
  }
}

export function createTerminalWorkspaceTabsCoordinator(
  options: TerminalWorkspaceTabsCoordinatorOptions,
): TerminalWorkspaceTabsCoordinator {
  return new TerminalWorkspaceTabsCoordinator(options)
}

export function isValidWorkspacePaneTabsOperation(value: unknown): value is TerminalUpdateWorkspaceTabsOperation {
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
