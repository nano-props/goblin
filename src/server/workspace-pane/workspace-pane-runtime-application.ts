import type {
  TerminalCreateInput,
  TerminalCreateResult,
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
import type { WorkspaceRuntimeTabPlacement } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  terminalSessionRuntimeScope,
  terminalSessionTargetWorktreePath,
} from '#/server/terminal/terminal-session-scope.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  PhysicalWorktreeExecutionCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { ServerTerminalCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { failRemoteRuntimeIfNeeded } from '#/server/modules/remote-runtime-failure-settlement.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'

type MaybePromise<T> = T | Promise<T>
const workspacePaneRuntimeApplicationLogger = serverLogger.child({ module: 'workspace-pane-runtime-application' })

interface WorkspacePaneRuntimeApplicationDependencies {
  workspaceTabsCoordinator: WorkspaceRuntimeTabPlacement
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
    const runtimeTarget = input.request.target
    const restorableTarget = restorableWorkspacePaneTargetFromRuntime(runtimeTarget)
    const worktreePath = terminalSessionTargetWorktreePath(runtimeTarget, input.request.worktreePath)
    if (
      !restorableTarget ||
      !worktreePath ||
      runtimeTarget.workspaceId !== input.request.repoRoot ||
      runtimeTarget.workspaceRuntimeId !== input.request.repoRuntimeId
    ) {
      return runtimeFailure(input.runtimeType, 'error.invalid-arguments')
    }
    const scope = terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoRuntimeId)
    if (!this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId)) {
      return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
    }
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(
        userId,
        input.request,
        worktreePath,
      )
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    let result: { admitted: true; value: WorkspacePaneRuntimeOpenResult } | { admitted: false }
    try {
      result = await this.deps.worktreeOperations.runOperation(physicalCapability, async (permit) => {
        switch (input.runtimeType) {
          case 'terminal':
            return await this.openTerminal(
              clientId,
              userId,
              input,
              runtimeTarget,
              scope,
              worktreePath,
              physicalCapability,
              permit,
            )
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
    const target = input.target
    const worktreePath = terminalSessionTargetWorktreePath(target.target, target.nativeWorktreePath)
    if (!worktreePath) return runtimeFailure(input.runtimeType, 'error.invalid-arguments')
    const scope = terminalSessionRuntimeScope(target.target.workspaceId, target.target.workspaceRuntimeId)
    if (!this.isCurrentTarget(userId, target)) return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(
        userId,
        { repoRoot: target.target.workspaceId, repoRuntimeId: target.target.workspaceRuntimeId },
        worktreePath,
      )
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
            return await this.closeTerminal(clientId, userId, worktreePath, input.sessionId, scope)
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
    target: NonNullable<TerminalWorkspacePaneRuntimeOpenInput['request']['target']>,
    scope: string,
    requestedWorktreePath: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const runtime = await this.deps.terminal.createAdmitted(
      clientId,
      userId,
      { ...input.request, target, worktreePath: requestedWorktreePath },
      {
        physicalWorktreeCapability,
        permit,
      },
    )
    if (!runtime.ok) return { ok: false, runtimeType: 'terminal', message: runtime.message }

    const worktreePath = requestedWorktreePath
    let committedRuntime: Extract<TerminalCreateResult, { ok: true }> | null = null
    let paneCommit
    try {
      paneCommit = await this.deps.workspaceTabsCoordinator.ensureRuntimeTabForSession({
        userId,
        target,
        worktreePath,
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: input.insertAfterIdentity,
        permit,
        physicalWorktreeCapability,
        isRuntimeCurrent: () =>
          this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId),
        commitAdmission: (canonicalBranch) => {
          const terminalBranch = canonicalBranch ?? ''
          committedRuntime = {
            ok: true,
            terminalSessionId: runtime.terminalSessionId,
            ...runtime.admission.commit({ canonicalBranch: terminalBranch }),
          }
        },
      })
    } catch (error) {
      if (committedRuntime === null) runtime.admission.abort()
      workspacePaneRuntimeApplicationLogger.error(
        { error, userId, repoRoot: input.request.repoRoot, worktreePath },
        'terminal open application command failed',
      )
      return runtimeFailure('terminal', 'error.unavailable')
    }
    if (paneCommit.kind === 'runtime-stale') {
      runtime.admission.abort()
      return runtimeFailure('terminal', 'error.repo-runtime-stale')
    }

    if (committedRuntime === null) throw new Error('terminal admission did not produce a committed result')
    runtime.admission.publishCommittedEffects()
    this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: committedRuntime,
    }
  }

  private async closeTerminal(
    clientId: string,
    userId: string,
    worktreePath: string,
    terminalSessionId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const sessions = await this.listTerminalSessions(userId, scope)
    const session = sessions.find(
      (candidate) => candidate.terminalSessionId === terminalSessionId && candidate.worktreePath === worktreePath,
    )
    if (session) {
      const closed = await this.deps.terminal.close(clientId, userId, {
        terminalRuntimeSessionId: session.terminalRuntimeSessionId,
      })
      if (!closed) return runtimeFailure('terminal', 'error.unavailable')
    }
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: session ? 'closed' : 'already-closed',
        terminalSessionId,
        terminalRuntimeSessionId: session?.terminalRuntimeSessionId ?? null,
        terminalRuntimeGeneration: session?.terminalRuntimeGeneration ?? null,
      },
    }
  }

  private async listTerminalSessions(userId: string, scope: string): Promise<TerminalSessionSummary[]> {
    return await this.deps.terminalWorktree.listSessionsForUser(userId, scope)
  }

  private isCurrentTarget(userId: string, target: WorkspacePaneRuntimeCommandTarget): boolean {
    return this.deps.isCurrentRepoRuntime(userId, target.target.workspaceId, target.target.workspaceRuntimeId)
  }

  private async capturePhysicalWorktree(
    userId: string,
    target: { repoRoot: string; repoRuntimeId: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    const input = {
      userId,
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      worktreePath,
    }
    return await this.deps.physicalWorktrees.capture(input)
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
