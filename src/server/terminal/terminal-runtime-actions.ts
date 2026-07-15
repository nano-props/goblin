import { isValidRepoLocator } from '#/shared/input-validation.ts'
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
  TerminalSessionsRecoveryResult,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import { isValidTerminalRuntimeSessionId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { isCurrentRepoRuntime as isCurrentRepoRuntimeOpen } from '#/server/modules/repo-runtimes.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { PhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

interface TerminalSessionServiceLike {
  prune(
    clientId: string,
    userId: string,
    repoRoot: string,
    repoRuntimeId: string,
  ): Promise<{ pruned: number; remaining: number }>
  listSessions(userId: string, repoRoot: string, repoRuntimeId: string): Promise<TerminalSessionSummary[]>
  listWorkspaceTabs(userId: string, repoRoot: string, repoRuntimeId: string): Promise<WorkspacePaneTabsSnapshot>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSessionManager<string>
  broker: Pick<RealtimeBroker<AppRealtimeMessage>, 'broadcastToUser'>
  sessionService: TerminalSessionServiceLike
  isValidTerminalClientId(value: unknown): value is string
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
      const session = manager.getSessionSummaryForUser(userId, terminalRuntimeSessionId)
      const physicalWorktreeCapability = manager.getPhysicalWorktreeExecutionCapabilityForUser(
        userId,
        terminalRuntimeSessionId,
      )
      if (!physicalWorktreeCapability) return { ok: false, message: 'error.invalid-worktree-capability' }
      const terminalClientId = input.clientId ?? clientId
      const operation = await worktreeOperations.runOperation(
        physicalWorktreeCapability,
        async (_permit, context) =>
          await manager.restartSession(
            userId,
            terminalRuntimeSessionId,
            input.cols,
            input.rows,
            terminalClientId,
            context.signal,
          ),
      )
      if (!operation.admitted) return { ok: false, message: 'error.worktree-removal-in-progress' }
      const result = operation.value
      if (session) broadcastRepoSessionsChanged(userId, session.repoRoot)
      return result
    },

    async prune(
      clientId: string,
      userId: string,
      input: TerminalPruneInput,
    ): Promise<{ pruned: number; remaining: number }> {
      if (!isValidTerminalClientId(clientId)) return { pruned: 0, remaining: 0 }
      if (!isValidRepoLocator(input.repoRoot)) return { pruned: 0, remaining: 0 }
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      return await sessionService.prune(clientId, userId, input.repoRoot, input.repoRuntimeId)
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
      if (!isValidTerminalClientId(clientId)) return false
      // Look up the session BEFORE closing so we know its scope
      // (for the per-session broadcast). The session is gone after
      // `closeSessionForUser` returns, so a post-close lookup would
      // always miss. The lookup is also gated on validity so a
      // malformed input never throws inside the action.
      const session = isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId)
        ? manager.getSessionSummaryForUser(userId, input.terminalRuntimeSessionId)
        : null
      const closed = isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId)
        ? await manager.closeSessionForUser(userId, input.terminalRuntimeSessionId)
        : false
      if (closed && session) {
        // General repo/session-list invalidation is emitted by the
        // manager close lifecycle. This action owns only the targeted
        // sibling-window event; other users must not hear about this
        // session id.
        broker.broadcastToUser(userId, {
          type: 'session-closed',
          terminalRuntimeSessionId: input.terminalRuntimeSessionId,
          terminalRuntimeGeneration: session.terminalRuntimeGeneration,
          terminalSessionId: session.terminalSessionId,
          repoRoot: session.repoRoot,
          worktreePath: session.worktreePath,
        })
      }
      return closed
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
    ): Promise<TerminalSessionsRecoveryResult> {
      if (!isValidTerminalClientId(clientId) || !isValidRepoLocator(input.repoRoot)) {
        return {
          terminalSessions: { revision: 0, sessions: [] },
          snapshots: [],
          workspacePaneTabs: { revision: 0, entries: [] },
        }
      }
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
      const terminalSessions = manager.terminalSessionsSnapshotForUser(userId, scope)
      const workspacePaneTabs = await sessionService.listWorkspaceTabs(userId, input.repoRoot, input.repoRuntimeId)
      return { terminalSessions, snapshots: [], workspacePaneTabs }
    },

    async listSessions(
      clientId: string,
      userId: string,
      input: TerminalListSessionsInput,
    ): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(input.repoRoot)) return []
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      return await sessionService.listSessions(userId, input.repoRoot, input.repoRuntimeId)
    },
  }

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', repoRoot })
  }

  function assertCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): void {
    if (!isCurrentRepoRuntimeOpen(userId, repoRoot, repoRuntimeId)) {
      throw new Error('error.repo-runtime-stale')
    }
  }
}
