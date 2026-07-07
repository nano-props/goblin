import PQueue from 'p-queue'
import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneTabsUserQueueKey,
  workspacePaneTabsUserQueueTarget,
} from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import type { WorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import {
  workspacePaneTabsWithRuntimeTab,
  workspacePaneTabsWithUpdateOperation,
} from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import {
  canonicalWorkspaceRuntimeTabsForTarget,
  projectWorkspaceRuntimeTabsFromProviderSnapshots,
  type WorkspacePaneRuntimeTabsProviderSnapshot,
  workspaceRuntimeTabWorktreePaths,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'

type WorkspacePaneTabsCoordinatorRuntime = Pick<
  WorkspacePaneTabsRuntime<string>,
  'replaceTabs' | 'tabs' | 'tabsForScope'
>

export interface WorkspacePaneRuntimeTabsLiveSession {
  sessionId: string
  branch: string
  worktreePath: string
}

export interface WorkspacePaneRuntimeTabsProvider {
  type: WorkspacePaneRuntimeTabType
  listSessionsForUser(userId: string, scope: string): Promise<WorkspacePaneRuntimeTabsLiveSession[]>
}

interface WorkspacePaneTabsCoordinatorOptions {
  runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
  private readonly operationQueuesByTarget = new Map<string, PQueue>()

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.workspaceTabs = options.workspaceTabs
  }

  async ensureRuntimeTabForSession<TFailure>(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string
    runtimeType: WorkspacePaneRuntimeTabType
    sessionId: string
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
        const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
          input.userId,
          input.scope,
          input.worktreePath,
        )
        const failure = input.guardBeforeWrite?.() ?? null
        if (failure) return failure
        const proposedTabs = workspacePaneTabsWithRuntimeTab(
          this.workspaceTabs.tabs(target),
          input.runtimeType,
          input.sessionId,
          { insertAfterIdentity: input.insertAfterIdentity ?? null },
        )
        return this.workspaceTabs.replaceTabs({
          ...target,
          tabs: canonicalWorkspaceRuntimeTabsForTarget({
            entry: {
              branchName: input.branchName,
              worktreePath: input.worktreePath,
              tabs: proposedTabs,
            },
            providerSnapshots,
          }),
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
        const tabs = await this.canonicalRuntimeTabsForTarget(input)
        input.assertCurrent()
        return this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          tabs,
        })
      },
    )
  }

  async updateTabs(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string | null
    operation: WorkspacePaneTabsUpdateOperation
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabEntry[]> {
    return await this.runWorkspaceTabsOperation(
      input.userId,
      input.scope,
      input.branchName,
      input.worktreePath,
      async () => {
        input.assertCurrent()
        const target = {
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
        }
        const updatedTabs = workspacePaneTabsWithUpdateOperation(this.workspaceTabs.tabs(target), input.operation)
        const tabs = await this.canonicalRuntimeTabsForTarget({ ...input, tabs: updatedTabs })
        input.assertCurrent()
        return this.workspaceTabs.replaceTabs({ ...target, tabs })
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
      const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
        input.userId,
        input.scope,
        input.worktreePath,
      )
      input.assertCurrent?.()
      const replacements = projectWorkspaceRuntimeTabsFromProviderSnapshots({
        entries: this.workspaceTabs
          .tabsForScope({ userId: input.userId, scope: input.scope })
          .filter((entry) => entry.worktreePath === input.worktreePath),
        providerSnapshots,
        worktreePath: input.worktreePath,
      })
      input.assertCurrent?.()
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

  private async canonicalRuntimeTabsForTarget(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  }): Promise<WorkspacePaneTabEntry[]> {
    return canonicalWorkspaceRuntimeTabsForTarget({
      entry: {
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        tabs: input.tabs,
      },
      providerSnapshots: await this.runtimeProviderSnapshotsForTarget(input),
    })
  }

  private async runtimeProviderSnapshotsForTarget(input: {
    userId: string
    scope: string
    worktreePath: string | null
  }): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    if (input.worktreePath === null) {
      return this.runtimeProviders.map((provider) => ({ type: provider.type, liveSessions: [] }))
    }
    return await this.runtimeProviderSnapshotsForWorktree(input.userId, input.scope, input.worktreePath)
  }

  private async runtimeProviderSnapshotsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(
      this.runtimeProviders.map(async (provider) => ({
        type: provider.type,
        liveSessions: (await provider.listSessionsForUser(userId, scope)).filter(
          (session) => session.worktreePath === worktreePath,
        ),
      })),
    )
  }

  private async runtimeProviderSnapshotsForScope(
    userId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(
      this.runtimeProviders.map(async (provider) => ({
        type: provider.type,
        liveSessions: await provider.listSessionsForUser(userId, scope),
      })),
    )
  }

  private async reconcileWorkspaceTabsProjectionBoundary(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
    broadcastChanged: () => void
  }): Promise<void> {
    const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
    input.assertCurrent()
    const scopeEntries = this.workspaceTabs.tabsForScope({ userId: input.userId, scope: input.scope })
    const worktreePaths = workspaceRuntimeTabWorktreePaths({ entries: scopeEntries, providerSnapshots })
    const replacementGroups = await Promise.all(
      worktreePaths.map(async (worktreePath) => {
        const worktreeProviderSnapshots = await this.runtimeProviderSnapshotsForWorktree(
          input.userId,
          input.scope,
          worktreePath,
        )
        return projectWorkspaceRuntimeTabsFromProviderSnapshots({
          entries: scopeEntries.filter((entry) => entry.worktreePath === worktreePath),
          providerSnapshots: worktreeProviderSnapshots,
          worktreePath,
        })
      }),
    )
    const replacements = replacementGroups.flat()
    // Read-side canonicalization boundary: runtime tabs are a projection of
    // server-owned live sessions. Listing tabs self-heals missing runtime
    // entries so reload/restore always returns a coherent tab strip.
    input.assertCurrent()
    for (const replacement of replacements) {
      this.workspaceTabs.replaceTabs({
        userId: input.userId,
        scope: input.scope,
        branchName: replacement.branchName,
        worktreePath: replacement.worktreePath,
        tabs: replacement.tabs,
      })
    }
    if (replacements.length > 0) input.broadcastChanged()
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

export function createWorkspacePaneTabsCoordinator(
  options: WorkspacePaneTabsCoordinatorOptions,
): WorkspacePaneTabsCoordinator {
  return new WorkspacePaneTabsCoordinator(options)
}

export function isValidWorkspacePaneTabsOperation(value: unknown): value is WorkspacePaneTabsUpdateOperation {
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
