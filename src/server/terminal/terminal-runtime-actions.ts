import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalMutationResult,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalResizeInput,
  TerminalResizeResult,
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalSessionsSnapshot,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import {
  isValidTerminalRuntimeSessionId,
  isValidTerminalSize,
  isValidTerminalWriteData,
} from '#/shared/terminal-validators.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { PhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import type { TerminalCloseOutcome, TerminalSessionCloseOutcome } from '#/server/terminal/terminal-session-close.ts'

interface TerminalSessionServiceLike {
  prune(
    clientId: string,
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    assertCurrentMembership: () => void,
  ): Promise<{ pruned: number; remaining: number }>
  listSessions(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    assertCurrentMembership: () => void,
  ): Promise<TerminalSessionSummary[]>
}

interface TerminalRuntimeActionDependencies {
  manager: Pick<
    TerminalSessionManager<string>,
    | 'attachSession'
    | 'restartSessionWithProjectionOutcome'
    | 'writeSession'
    | 'resizeSession'
    | 'takeoverSession'
    | 'closeSessionForUserOutcome'
    | 'getPhysicalWorktreeExecutionCapabilityForUser'
    | 'terminalSessionsSnapshotForUser'
  >
  broker: Pick<RealtimeBroker<AppRealtimeMessage>, 'broadcastToUser'>
  sessionService: TerminalSessionServiceLike
  isValidTerminalClientId(value: unknown): value is string
  isCurrentWorkspaceRuntimeMembership(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    clientId: string,
  ): boolean
  worktreeOperations: Pick<PhysicalWorktreeOperationCoordinator, 'runOperation'>
}

// Manager, broker, and session service all use `userId` as the terminal
// partition. `clientId` remains a per-page request validator/routing
// identifier, but it must not decide session visibility or lifecycle
// fanout.
export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, sessionService, isValidTerminalClientId, worktreeOperations } = deps

  return {
    async attach(clientId: string, userId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const result = await manager.attachSession(
        userId,
        input.terminalRuntimeSessionId,
        input.terminalRuntimeGeneration,
        input.cols,
        input.rows,
        clientId,
      )
      return result
    },

    async restart(clientId: string, userId: string, input: TerminalRestartInput): Promise<TerminalRestartResult> {
      const terminalRuntimeSessionId = input?.terminalRuntimeSessionId
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalRuntimeSessionId(terminalRuntimeSessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const physicalWorktreeCapability = manager.getPhysicalWorktreeExecutionCapabilityForUser(
        userId,
        terminalRuntimeSessionId,
      )
      if (!physicalWorktreeCapability) return { ok: false, message: 'error.invalid-worktree-capability' }
      const operation = await worktreeOperations.runOperation(
        physicalWorktreeCapability,
        async (_permit, context) =>
          await manager.restartSessionWithProjectionOutcome(
            userId,
            terminalRuntimeSessionId,
            input.terminalRuntimeGeneration,
            input.cols,
            input.rows,
            clientId,
            context.signal,
          ),
      )
      if (!operation.admitted) return { ok: false, message: 'error.worktree-removal-in-progress' }
      const { result, projectionChanged } = operation.value
      if (projectionChanged) {
        broker.broadcastToUser(userId, {
          type: 'sessions-changed',
          ...projectionChanged,
        })
      }
      return result
    },

    async prune(
      clientId: string,
      userId: string,
      input: TerminalPruneInput,
    ): Promise<{ pruned: number; remaining: number }> {
      if (!isValidTerminalClientId(clientId)) return { pruned: 0, remaining: 0 }
      if (!isValidWorkspaceLocatorInput(input.workspaceId)) return { pruned: 0, remaining: 0 }
      const assertCurrentMembership = membershipAssertion(clientId, userId, input)
      assertCurrentMembership()
      return await sessionService.prune(
        clientId,
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        assertCurrentMembership,
      )
    },

    async write(clientId: string, userId: string, input: TerminalWriteInput): Promise<TerminalWriteResult> {
      if (!isValidTerminalClientId(clientId)) return { status: 'rejected' }
      if (
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isBoundTerminalRuntimeGeneration(input?.terminalRuntimeGeneration) ||
        !isValidTerminalWriteData(input?.data)
      ) {
        return { status: 'rejected' }
      }
      return await manager.writeSession(
        userId,
        input.terminalRuntimeSessionId,
        input.terminalRuntimeGeneration,
        input.data,
        clientId,
      )
    },

    async resize(clientId: string, userId: string, input: TerminalResizeInput): Promise<TerminalResizeResult> {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isBoundTerminalRuntimeGeneration(input?.terminalRuntimeGeneration) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      return await manager.resizeSession(
        userId,
        input.terminalRuntimeSessionId,
        input.terminalRuntimeGeneration,
        input.cols,
        input.rows,
        clientId,
      )
    },

    async close(clientId: string, userId: string, input: TerminalSessionInput): Promise<TerminalMutationResult> {
      return (await closeOutcome(clientId, userId, input)).kind === 'closed'
    },

    async closeForWorkspacePane(
      clientId: string,
      userId: string,
      input: TerminalSessionInput,
    ): Promise<TerminalCloseOutcome> {
      const outcome = await closeOutcome(clientId, userId, input)
      return { kind: outcome.kind }
    },

    async takeover(clientId: string, userId: string, input: TerminalTakeoverInput): Promise<TerminalTakeoverResult> {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isBoundTerminalRuntimeGeneration(input?.terminalRuntimeGeneration) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      return await manager.takeoverSession(
        userId,
        input.terminalRuntimeSessionId,
        input.terminalRuntimeGeneration,
        input.cols,
        input.rows,
        clientId,
      )
    },

    async recoverSessions(
      clientId: string,
      userId: string,
      input: TerminalListSessionsInput,
    ): Promise<TerminalSessionsSnapshot> {
      if (!isValidTerminalClientId(clientId) || !isValidWorkspaceLocatorInput(input.workspaceId)) {
        return { revision: 0, sessions: [] }
      }
      membershipAssertion(clientId, userId, input)()
      const scope = terminalSessionRuntimeScope(input.workspaceId, input.workspaceRuntimeId)
      return manager.terminalSessionsSnapshotForUser(userId, scope)
    },

    async listSessions(
      clientId: string,
      userId: string,
      input: TerminalListSessionsInput,
    ): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidWorkspaceLocatorInput(input.workspaceId)) return []
      const assertCurrentMembership = membershipAssertion(clientId, userId, input)
      assertCurrentMembership()
      return await sessionService.listSessions(
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        assertCurrentMembership,
      )
    },
  }

  async function closeOutcome(
    clientId: string,
    userId: string,
    input: TerminalSessionInput,
  ): Promise<TerminalSessionCloseOutcome> {
    if (!isValidTerminalClientId(clientId)) return { kind: 'failed' }
    if (!isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId)) return { kind: 'failed' }
    const outcome = await manager.closeSessionForUserOutcome(userId, input.terminalRuntimeSessionId)
    if (outcome.kind === 'closed') {
      const session = outcome.session
      // General repo/session-list invalidation is emitted by the
      // manager close lifecycle. This action owns only the targeted
      // sibling-window event; other users must not hear about this
      // session id.
      broker.broadcastToUser(userId, {
        type: 'session-closed',
        terminalRuntimeSessionId: input.terminalRuntimeSessionId,
        terminalRuntimeGeneration: session.terminalRuntimeGeneration,
        terminalSessionId: session.terminalSessionId,
        workspaceId: terminalSessionCoordinates(session).workspaceId,
      })
    }
    return outcome
  }

  function membershipAssertion(clientId: string, userId: string, input: TerminalListSessionsInput): () => void {
    return () => {
      if (!deps.isCurrentWorkspaceRuntimeMembership(userId, input.workspaceId, input.workspaceRuntimeId, clientId)) {
        throw new Error('error.workspace-runtime-stale')
      }
    }
  }
}

function isBoundTerminalRuntimeGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
