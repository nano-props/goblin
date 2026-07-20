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
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalSessionsSnapshot,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { isValidTerminalRuntimeSessionId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
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
  manager: TerminalSessionManager<string>
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
// partition. `clientId` remains a per-tab request validator/routing
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
      const terminalClientId = input.clientId ?? clientId
      const result = await manager.attachSession(
        userId,
        input.terminalRuntimeSessionId,
        input.cols,
        input.rows,
        terminalClientId,
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
      const terminalClientId = input.clientId ?? clientId
      const operation = await worktreeOperations.runOperation(
        physicalWorktreeCapability,
        async (_permit, context) =>
          await manager.restartSessionWithProjectionOutcome(
            userId,
            terminalRuntimeSessionId,
            input.cols,
            input.rows,
            terminalClientId,
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
      if (!isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) || !isValidTerminalWriteData(input?.data)) {
        return { status: 'rejected' }
      }
      const terminalClientId = input.clientId ?? clientId
      return await manager.writeSession(userId, input.terminalRuntimeSessionId, input.data, terminalClientId)
    },

    resize(clientId: string, userId: string, input: TerminalResizeInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return false
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.resizeSession(userId, input.terminalRuntimeSessionId, input.cols, input.rows, terminalClientId)
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

    takeover(clientId: string, userId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.takeoverSession(userId, input.terminalRuntimeSessionId, input.cols, input.rows, terminalClientId)
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
