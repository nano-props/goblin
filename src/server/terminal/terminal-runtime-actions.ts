import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalCreateInput,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalMutationResult,
  TerminalRestartInput,
  TerminalResizeInput,
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalSessionsRecoveryResult,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import { isValidTerminalRuntimeSessionId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { isCurrentRepoRuntime as isCurrentRepoRuntimeOpen } from '#/server/modules/repo-runtimes.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { PhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'

const MAX_TERMINAL_RECOVERY_PROJECTION_ATTEMPTS = 4

interface TerminalSessionServiceLike {
  create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult>
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
  worktreeOperations: Pick<PhysicalWorktreeOperationCoordinator, 'isRemovalAdmitted'>
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

    async restart(clientId: string, userId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
      const terminalRuntimeSessionId = input?.terminalRuntimeSessionId
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalRuntimeSessionId(terminalRuntimeSessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const session = manager.getSessionSummaryForUser(userId, terminalRuntimeSessionId)
      if (
        session &&
        worktreeOperations.isRemovalAdmitted({ repoRoot: session.repoRoot, worktreePath: session.worktreePath })
      ) {
        return { ok: false, message: 'error.worktree-removal-in-progress' }
      }
      const terminalClientId = input.clientId ?? clientId
      const result = await manager.restartSession(
        userId,
        terminalRuntimeSessionId,
        input.cols,
        input.rows,
        terminalClientId,
      )
      if (session) broadcastRepoSessionsChanged(userId, session.repoRoot)
      return result
    },

    async create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidRepoLocator(input?.repoRoot) ||
        !isValidBranch(input?.branch) ||
        !isValidCwd(input?.worktreePath)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      if (!isCurrentRepoRuntimeOpen(userId, input.repoRoot, input.repoRuntimeId)) {
        return { ok: false, message: 'error.repo-runtime-stale' }
      }
      return await sessionService.create(clientId, userId, input)
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

    write(clientId: string, userId: string, input: TerminalWriteInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (!isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) || !isValidTerminalWriteData(input?.data)) {
        return false
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.writeSession(userId, input.terminalRuntimeSessionId, input.data, terminalClientId)
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
        ? manager.closeSessionForUser(userId, input.terminalRuntimeSessionId)
        : false
      if (closed && session) {
        // General repo/session-list invalidation is emitted by the
        // manager close lifecycle. This action owns only the targeted
        // sibling-window event; other users must not hear about this
        // session id.
        broker.broadcastToUser(userId, {
          type: 'session-closed',
          terminalRuntimeSessionId: input.terminalRuntimeSessionId,
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
        return { sessions: [], snapshots: [], workspacePaneTabs: { revision: 0, entries: [] } }
      }
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      for (let attempt = 0; attempt < MAX_TERMINAL_RECOVERY_PROJECTION_ATTEMPTS; attempt += 1) {
        const tabsBefore = await sessionService.listWorkspaceTabs(userId, input.repoRoot, input.repoRuntimeId)
        const recovery = await manager.recoverSessionsForUser(
          userId,
          terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId),
        )
        const workspacePaneTabs = await sessionService.listWorkspaceTabs(userId, input.repoRoot, input.repoRuntimeId)
        if (tabsBefore.revision === workspacePaneTabs.revision) return { ...recovery, workspacePaneTabs }
      }
      throw new Error('error.terminal-recovery-unstable')
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
