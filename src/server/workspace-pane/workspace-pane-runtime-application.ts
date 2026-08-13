import type { TerminalCreateSuccess, TerminalSessionInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { terminalExecutionPath, terminalGitWorktreePresentation } from '#/shared/terminal-types.ts'
import type {
  TerminalWorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeCommandTarget,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { WorkspacePaneRuntimeTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  terminalSessionRuntimeScope,
  terminalSessionTargetExecutionPath,
} from '#/server/terminal/terminal-session-scope.ts'
import { serverNodeLog } from '#/node/logger.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeCapture } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { ServerTerminalCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { failRemoteWorkspaceRuntimeIfNeeded } from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'
import {
  WorkspaceRuntimeStaleError,
  type WorkspaceRuntimeMembershipCapability,
} from '#/server/modules/workspace-runtimes.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { runtimeWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceTerminalAvailable } from '#/shared/workspace-runtime.ts'
import { workspaceProbeStateForRuntime } from '#/server/modules/workspace-runtimes.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { TerminalCloseOutcome } from '#/server/terminal/terminal-session-close.ts'

type MaybePromise<T> = T | Promise<T>
type SuccessfulTerminalCloseOutcome = Exclude<TerminalCloseOutcome, { kind: 'failed' }>
type TerminalCloseRuntime = Extract<WorkspacePaneRuntimeCloseResult, { ok: true }>['runtime']
const workspacePaneRuntimeApplicationLogger = serverNodeLog.child({ module: 'workspace-pane-runtime-application' })

function terminalCloseRuntime(
  terminalSessionId: string,
  session: TerminalSessionSummary | undefined,
  close: SuccessfulTerminalCloseOutcome,
): TerminalCloseRuntime {
  if (!session || close.kind === 'already-closed') return { action: 'already-closed', terminalSessionId }
  return {
    action: 'closed',
    terminalSessionId,
    terminalRuntimeSessionId: session.terminalRuntimeSessionId,
    terminalRuntimeGeneration: session.terminalRuntimeGeneration,
  }
}

interface WorkspacePaneRuntimeApplicationDependencies {
  workspaceTabsCoordinator: WorkspacePaneRuntimeTabsCoordinator
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: PhysicalWorktreeCapture
  terminal: ServerTerminalCreateProvider & {
    close(clientId: string, userId: string, input: TerminalSessionInput): MaybePromise<TerminalCloseOutcome>
  }
  terminalSessions: {
    listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  }
  captureWorkspaceRuntimeMembershipCapability(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    clientId: string,
  ): WorkspaceRuntimeMembershipCapability
  broadcastWorkspaceTabsChanged(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    revision: number,
  ): void
  invalidateWorkspaceTabs(userId: string, workspaceId: WorkspaceId): void
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
    const executionPath = terminalSessionTargetExecutionPath(runtimeTarget)
    const workspaceId = runtimeTarget.workspaceId
    const workspaceRuntimeId = runtimeTarget.workspaceRuntimeId
    if (!restorableTarget || !executionPath) {
      return runtimeFailure(input.runtimeType, 'error.invalid-arguments')
    }
    const scope = terminalSessionRuntimeScope(workspaceId, workspaceRuntimeId)
    let runtimeCapability: WorkspaceRuntimeMembershipCapability
    try {
      runtimeCapability = this.deps.captureWorkspaceRuntimeMembershipCapability(
        userId,
        workspaceId,
        workspaceRuntimeId,
        clientId,
      )
    } catch (error) {
      if (error instanceof WorkspaceRuntimeStaleError) {
        return runtimeFailure(input.runtimeType, error.message)
      }
      throw error
    }
    // Runtime admission is a server-owned capability boundary. The client may
    // still render a terminal action from an older projection while a probe
    // transition is in flight, so never admit PTY creation from UI state.
    if (!this.terminalCapabilityAvailable(userId, workspaceId, workspaceRuntimeId)) {
      return runtimeFailure(input.runtimeType, 'error.unavailable')
    }
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(
        userId,
        { workspaceId, workspaceRuntimeId },
        executionPath,
      )
    } catch (error) {
      await failRemoteWorkspaceRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    let result: { admitted: true; value: WorkspacePaneRuntimeOpenResult } | { admitted: false }
    try {
      result = await this.deps.worktreeOperations.runOperation(physicalCapability, async (permit) => {
        runtimeCapability.assertCurrent()
        if (!this.terminalCapabilityAvailable(userId, workspaceId, workspaceRuntimeId)) {
          return runtimeFailure(input.runtimeType, 'error.unavailable')
        }
        switch (input.runtimeType) {
          case 'terminal':
            return await this.openTerminal(
              clientId,
              userId,
              input,
              runtimeTarget,
              scope,
              executionPath,
              physicalCapability,
              permit,
              runtimeCapability,
            )
        }
      })
    } catch (error) {
      await failRemoteWorkspaceRuntimeIfNeeded(userId, error)
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
    const executionPath = terminalSessionTargetExecutionPath(target.target)
    if (!executionPath) return runtimeFailure(input.runtimeType, 'error.invalid-arguments')
    const scope = terminalSessionRuntimeScope(target.target.workspaceId, target.target.workspaceRuntimeId)
    let runtimeCapability: WorkspaceRuntimeMembershipCapability
    try {
      runtimeCapability = this.deps.captureWorkspaceRuntimeMembershipCapability(
        userId,
        target.target.workspaceId,
        target.target.workspaceRuntimeId,
        clientId,
      )
    } catch (error) {
      if (error instanceof WorkspaceRuntimeStaleError) {
        return runtimeFailure(input.runtimeType, error.message)
      }
      throw error
    }
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.capturePhysicalWorktree(
        userId,
        { workspaceId: target.target.workspaceId, workspaceRuntimeId: target.target.workspaceRuntimeId },
        executionPath,
      )
    } catch (error) {
      await failRemoteWorkspaceRuntimeIfNeeded(userId, error)
      return runtimeFailure(input.runtimeType, error instanceof Error ? error.message : String(error))
    }
    let result: { admitted: true; value: WorkspacePaneRuntimeCloseResult } | { admitted: false }
    try {
      result = await this.deps.worktreeOperations.runOperation(physicalCapability, async (permit) => {
        runtimeCapability.assertCurrent()
        switch (input.runtimeType) {
          case 'terminal':
            return await this.closeTerminal(
              clientId,
              userId,
              target.target,
              executionPath,
              input.sessionId,
              scope,
              physicalCapability,
              permit,
              runtimeCapability,
            )
        }
      })
    } catch (error) {
      await failRemoteWorkspaceRuntimeIfNeeded(userId, error)
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
    requestedExecutionPath: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
    runtimeCapability: WorkspaceRuntimeMembershipCapability,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const runtime = await this.deps.terminal.createAdmitted(
      clientId,
      userId,
      {
        kind: input.request.kind,
        startupShellCommand: input.request.startupShellCommand,
        target,
      },
      {
        physicalWorktreeCapability,
        permit,
      },
    )
    if (!runtime.ok) return { ok: false, runtimeType: 'terminal', message: runtime.message }

    const executionPath = requestedExecutionPath
    let committedRuntime: TerminalCreateSuccess | null = null
    let paneCommit
    try {
      paneCommit = await this.deps.workspaceTabsCoordinator.ensureRuntimeTabForSession({
        userId,
        target,
        worktreePath: executionPath,
        runtimeType: 'terminal',
        sessionId: runtime.terminalSessionId,
        insertAfterIdentity: input.insertAfterIdentity,
        permit,
        physicalWorktreeCapability,
        epochCapability: runtimeCapability,
        commitAdmission: (canonicalBranch) => {
          const presentation =
            target.kind === 'workspace-root'
              ? ({ kind: 'workspace-root' } as const)
              : terminalGitWorktreePresentation(canonicalBranch)
          committedRuntime = {
            ok: true,
            terminalSessionId: runtime.terminalSessionId,
            ...runtime.admission.commit({ presentation }),
          }
        },
      })
    } catch (error) {
      if (committedRuntime === null) runtime.admission.abort()
      if (error instanceof WorkspaceRuntimeStaleError) {
        return runtimeFailure('terminal', error.message)
      }
      workspacePaneRuntimeApplicationLogger.error(
        { error, userId, workspaceId: target.workspaceId, executionPath },
        'terminal open application command failed',
      )
      return runtimeFailure('terminal', 'error.unavailable')
    }
    if (paneCommit.kind === 'runtime-stale' || paneCommit.kind === 'target-stale') {
      runtime.admission.abort()
      return runtimeFailure(
        'terminal',
        paneCommit.kind === 'target-stale' ? 'error.workspace-target-stale' : 'error.workspace-runtime-stale',
      )
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
    executionPath: string,
    terminalSessionId: string,
    scope: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
    runtimeCapability: WorkspaceRuntimeMembershipCapability,
  ): Promise<WorkspacePaneRuntimeCloseResult> {
    const sessions = await this.listTerminalSessions(userId, scope)
    runtimeCapability.assertCurrent()
    const targetKey = runtimeWorkspacePaneTargetKey(target)
    if (!targetKey) return runtimeFailure('terminal', 'error.invalid-arguments')
    const session = sessions.find((candidate) => candidate.terminalSessionId === terminalSessionId)
    if (
      session &&
      (terminalExecutionPath(session.target) !== executionPath ||
        runtimeWorkspacePaneTargetKey(session.target) !== targetKey)
    ) {
      return runtimeFailure('terminal', 'error.workspace-runtime-stale')
    }
    const close: TerminalCloseOutcome = session
      ? await this.deps.terminal.close(clientId, userId, {
          terminalRuntimeSessionId: session.terminalRuntimeSessionId,
        })
      : { kind: 'already-closed' }
    if (close.kind === 'failed') return runtimeFailure('terminal', 'error.unavailable')
    const runtime = terminalCloseRuntime(terminalSessionId, session, close)

    let paneTabsSnapshot: WorkspacePaneTabsSnapshot | null
    try {
      paneTabsSnapshot = await this.deps.workspaceTabsCoordinator.reconcileWorktreeAdmitted({
        userId,
        workspaceId: target.workspaceId,
        scope,
        worktreePath: executionPath,
        physicalWorktreeCapability,
        permit,
        epochCapability: runtimeCapability,
      })
      this.deps.broadcastWorkspaceTabsChanged(
        userId,
        target.workspaceId,
        target.workspaceRuntimeId,
        paneTabsSnapshot.revision,
      )
    } catch (error) {
      this.deps.invalidateWorkspaceTabs(userId, target.workspaceId)
      if (!(error instanceof WorkspaceRuntimeStaleError)) {
        workspacePaneRuntimeApplicationLogger.warn(
          { error, userId, workspaceId: target.workspaceId, terminalSessionId },
          'terminal close committed but workspace tabs projection failed',
        )
      }
      paneTabsSnapshot = null
    }
    return {
      ok: true,
      runtimeType: 'terminal',
      runtime,
      paneTabsSnapshot,
    }
  }

  private async listTerminalSessions(userId: string, scope: string): Promise<TerminalSessionSummary[]> {
    return await this.deps.terminalSessions.listSessionsForUser(userId, scope)
  }

  private terminalCapabilityAvailable(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): boolean {
    return workspaceTerminalAvailable(workspaceProbeStateForRuntime(userId, workspaceId, workspaceRuntimeId))
  }

  private async capturePhysicalWorktree(
    userId: string,
    target: { workspaceId: WorkspaceId; workspaceRuntimeId: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    const input = {
      userId,
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
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
