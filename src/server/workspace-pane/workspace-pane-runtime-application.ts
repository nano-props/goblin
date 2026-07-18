import type { TerminalCreateResult, TerminalSessionInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { terminalExecutionPath } from '#/shared/terminal-types.ts'
import type {
  TerminalWorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeCommandTarget,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import {
  WorkspacePaneRuntimeStaleError,
  type WorkspaceRuntimeTabPlacement,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  terminalSessionRuntimeScope,
  terminalSessionTargetWorktreePath,
} from '#/server/terminal/terminal-session-scope.ts'
import { serverLogger } from '#/server/logger.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { ServerTerminalCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { failRemoteRuntimeIfNeeded } from '#/server/modules/remote-runtime-failure-settlement.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { runtimeWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'

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
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string, workspaceRuntimeId: string, revision: number): void
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
    const worktreePath = terminalSessionTargetWorktreePath(runtimeTarget)
    const repoRoot = runtimeTarget.workspaceId
    const repoRuntimeId = runtimeTarget.workspaceRuntimeId
    if (!restorableTarget || !worktreePath) {
      return runtimeFailure(input.runtimeType, 'error.invalid-arguments')
    }
    const scope = terminalSessionRuntimeScope(repoRoot, repoRuntimeId)
    if (!this.deps.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)) {
      return runtimeFailure(input.runtimeType, 'error.repo-runtime-stale')
    }
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(userId, { repoRoot, repoRuntimeId }, worktreePath)
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
    const worktreePath = terminalSessionTargetWorktreePath(target.target)
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
            return await this.closeTerminal(clientId, userId, target.target, worktreePath, input.sessionId, scope)
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
      {
        kind: input.request.kind,
        startupShellCommand: input.request.startupShellCommand,
        cols: input.request.cols,
        rows: input.request.rows,
        clientId: input.request.clientId,
        target,
      },
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
        isRuntimeCurrent: () => this.deps.isCurrentRepoRuntime(userId, target.workspaceId, target.workspaceRuntimeId),
        commitAdmission: (canonicalBranch) => {
          const presentation =
            target.kind === 'workspace-root'
              ? ({ kind: 'workspace-root' } as const)
              : canonicalBranch
                ? ({ kind: 'git-worktree', branchName: canonicalBranch } as const)
                : null
          if (!presentation) throw new Error('terminal presentation unavailable')
          committedRuntime = {
            ok: true,
            terminalSessionId: runtime.terminalSessionId,
            ...runtime.admission.commit({ presentation }),
          }
        },
      })
    } catch (error) {
      if (committedRuntime === null) runtime.admission.abort()
      workspacePaneRuntimeApplicationLogger.error(
        { error, userId, repoRoot: target.workspaceId, worktreePath },
        'terminal open application command failed',
      )
      return runtimeFailure(
        'terminal',
        error instanceof WorkspacePaneRuntimeStaleError ? 'error.repo-runtime-stale' : 'error.unavailable',
      )
    }
    if (paneCommit.kind === 'runtime-stale') {
      runtime.admission.abort()
      return runtimeFailure('terminal', 'error.repo-runtime-stale')
    }

    if (committedRuntime === null) throw new Error('terminal admission did not produce a committed result')
    runtime.admission.publishCommittedEffects()
    this.deps.broadcastWorkspaceTabsChanged(
      userId,
      target.workspaceId,
      target.workspaceRuntimeId,
      paneCommit.snapshot.revision,
    )
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime: committedRuntime,
      paneTabsSnapshot: paneCommit.snapshot,
    }
  }

  private async closeTerminal(
    clientId: string,
    userId: string,
    target: WorkspacePaneRuntimeCommandTarget['target'],
    worktreePath: string,
    terminalSessionId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const sessions = await this.listTerminalSessions(userId, scope)
    const targetKey = runtimeWorkspacePaneTargetKey(target)
    if (!targetKey) return runtimeFailure('terminal', 'error.invalid-arguments')
    const session = sessions.find((candidate) => candidate.terminalSessionId === terminalSessionId)
    if (
      session &&
      (terminalExecutionPath(session.target) !== worktreePath ||
        runtimeWorkspacePaneTargetKey(session.target) !== targetKey)
    ) {
      return runtimeFailure('terminal', 'error.repo-runtime-stale')
    }
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
