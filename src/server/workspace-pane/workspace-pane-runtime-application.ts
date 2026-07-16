import type {
  TerminalCreateInput,
  TerminalSessionInput,
  TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
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
import type {
  PhysicalWorktreeExecutionCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { ServerTerminalCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { failRemoteRuntimeIfNeeded } from '#/server/modules/remote-runtime-failure-settlement.ts'

type MaybePromise<T> = T | Promise<T>
const workspacePaneRuntimeApplicationLogger = serverLogger.child({ module: 'workspace-pane-runtime-application' })

interface WorkspacePaneRuntimeApplicationDependencies {
  workspaceTabsCoordinator: Pick<
    WorkspacePaneTabsCoordinator,
    'ensureRuntimeTabForSession' | 'reconcileWorktreeAdmitted'
  >
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  terminal: ServerTerminalCreateProvider & {
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
    if (!this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId)) {
      return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
    }
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(userId, input.request, worktreePath)
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    let result: { admitted: true; value: WorkspacePaneRuntimeOpenResult } | { admitted: false }
    try {
      result = await this.deps.worktreeOperations.runOperation(physicalCapability, async (permit) => {
        switch (input.runtimeType) {
          case 'terminal':
            return await this.openTerminal(clientId, userId, input, scope, worktreePath, physicalCapability, permit)
        }
      })
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    return result.admitted ? result.value : runtimeFailure(input.runtimeType, 'error.worktree-removal-in-progress')
  }

  async close(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeCloseInput,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const target = normalizedRuntimeTarget(input.target)
    const scope = terminalSessionRuntimeScope(target.repoRoot, target.repoRuntimeId)
    if (!this.isCurrentTarget(userId, target)) return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(userId, target, target.worktreePath)
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    let result: { admitted: true; value: WorkspacePaneRuntimeCloseResult } | { admitted: false }
    try {
      result = await this.deps.worktreeOperations.runOperation(physicalCapability, async (permit) => {
        if (!this.isCurrentTarget(userId, target)) return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
        switch (input.runtimeType) {
          case 'terminal':
            return await this.closeTerminal(clientId, userId, target, input.sessionId, scope, physicalCapability, permit)
        }
      })
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    return result.admitted ? result.value : runtimeFailure(input.runtimeType, 'error.worktree-removal-in-progress')
  }

  private async openTerminal(
    clientId: string,
    userId: string,
    input: TerminalWorkspacePaneRuntimeOpenInput,
    scope: string,
    requestedWorktreePath: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const runtime = await this.deps.terminal.createAdmitted(clientId, userId, input.request, {
      physicalWorktreeCapability,
      permit,
    })
    if (!runtime.ok) return { ok: false, runtimeType: 'terminal', message: runtime.message }

    const worktreePath = requestedWorktreePath
    let admittedRevision =
      runtime.admission.kind === 'existing' ? runtime.admission.terminalSessionsRevision : null
    let paneCommit
    try {
      paneCommit = await this.deps.workspaceTabsCoordinator.ensureRuntimeTabForSession({
        userId,
        repoRoot: input.request.repoRoot,
        scope,
        branchName: input.request.branch,
        worktreePath,
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: input.insertAfterIdentity,
        permit,
        physicalWorktreeCapability,
        isRuntimeCurrent: () =>
          this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId),
        onPlacementCommitted:
          runtime.admission.kind === 'prepared'
            ? () => {
                admittedRevision = runtime.admission.kind === 'prepared' ? runtime.admission.commit() : null
                if (admittedRevision === null) throw new Error('error.unavailable')
                return admittedRevision
              }
            : undefined,
      })
    } catch (error) {
      if (runtime.admission.kind === 'prepared' && admittedRevision === null) runtime.admission.abort()
      if (admittedRevision !== null) {
        this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
      }
      workspacePaneRuntimeApplicationLogger.error(
        { error, userId, repoRoot: input.request.repoRoot, worktreePath },
        'terminal open application command failed',
      )
      return runtimeFailure('terminal', 'error.unavailable')
    }
    if (paneCommit.kind === 'runtime-stale') {
      if (runtime.admission.kind === 'prepared') runtime.admission.abort()
      return runtimeFailure('terminal', 'error.repo-runtime-stale')
    }

    if (admittedRevision === null) throw new Error('terminal admission did not produce a catalog revision')
    const { admission: _admission, ...runtimeResult } = runtime
    const workspacePaneTabs = paneCommit.snapshot
    this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: { ...runtimeResult, terminalSessionsRevision: admittedRevision },
      workspacePaneTabs,
    }
  }

  private async closeTerminal(
    clientId: string,
    userId: string,
    target: NormalizedRuntimeTarget,
    terminalSessionId: string,
    scope: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
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
    const workspacePaneTabs = await this.reconcileTarget(userId, target, scope, physicalWorktreeCapability, permit)
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: session ? 'closed' : 'already-closed',
        terminalSessionId,
        terminalRuntimeSessionId: session?.terminalRuntimeSessionId ?? null,
        terminalRuntimeGeneration: session?.terminalRuntimeGeneration ?? null,
      },
      workspacePaneTabs,
    }
  }

  private async listTerminalSessions(userId: string, scope: string): Promise<TerminalSessionSummary[]> {
    return await this.deps.terminalWorktree.listSessionsForUser(userId, scope)
  }

  private async reconcileTarget(
    userId: string,
    target: NormalizedRuntimeTarget,
    scope: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
  ): Promise<WorkspacePaneTabsSnapshot> {
    const snapshot = await this.deps.workspaceTabsCoordinator.reconcileWorktreeAdmitted({
      userId,
      repoRoot: target.repoRoot,
      scope,
      worktreePath: target.worktreePath,
      physicalWorktreeCapability,
      permit,
    })
    this.deps.broadcastWorkspaceTabsChanged(userId, target.repoRoot)
    return snapshot
  }

  private isCurrentTarget(userId: string, target: WorkspacePaneRuntimeCommandTarget): boolean {
    return this.deps.isCurrentRepoRuntime(userId, target.repoRoot, target.repoRuntimeId)
  }

  private async capturePhysicalWorktree(
    userId: string,
    target: { repoRoot: string; repoRuntimeId: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    return await this.deps.physicalWorktrees.capture({
      userId,
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      worktreePath,
    })
  }
}

interface NormalizedRuntimeTarget extends WorkspacePaneRuntimeCommandTarget {
  worktreePath: string
}

function normalizedRuntimeTarget(target: WorkspacePaneRuntimeCommandTarget): NormalizedRuntimeTarget {
  return {
    ...target,
    worktreePath: terminalSessionWorktreePath(target.repoRoot, target.worktreePath),
  }
}

function runtimeFailure<TType extends 'terminal'>(runtimeType: TType, message: string) {
  return { ok: false as const, runtimeType, message }
}

export function createWorkspacePaneRuntimeApplication(
  deps: WorkspacePaneRuntimeApplicationDependencies,
): WorkspacePaneRuntimeApplication {
  return new WorkspacePaneRuntimeApplication(deps)
}
