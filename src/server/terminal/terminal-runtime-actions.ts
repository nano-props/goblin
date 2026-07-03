import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalCreateInput,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalListWorkspaceTabsInput,
  TerminalMutationResult,
  TerminalReplaceWorkspaceTabsInput,
  TerminalRestartInput,
  TerminalResizeInput,
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalUpdateWorkspaceTabsInput,
  WorkspacePaneTabsEntry,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { isValidTerminalRuntimeSessionId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import type { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { isCurrentRepoRuntimeInstance } from '#/server/modules/repo-runtime-instances.ts'

interface TerminalSessionServiceLike {
  create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult>
  prune(
    clientId: string,
    userId: string,
    repoRoot: string,
    repoInstanceId: string,
  ): Promise<{ pruned: number; remaining: number }>
  listSessions(userId: string, repoRoot: string, repoInstanceId: string): Promise<TerminalSessionSummary[]>
  listWorkspaceTabs(userId: string, repoRoot: string, repoInstanceId: string): Promise<WorkspacePaneTabsEntry[]>
  replaceTabs(userId: string, input: TerminalReplaceWorkspaceTabsInput): Promise<WorkspacePaneTabEntry[]>
  updateTabs(userId: string, input: TerminalUpdateWorkspaceTabsInput): Promise<WorkspacePaneTabEntry[]>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSessionManager<string>
  broker: Pick<TerminalRealtimeBroker, 'broadcastToUser'>
  sessionService: TerminalSessionServiceLike
  isValidTerminalClientId(value: unknown): value is string
}

// Manager, broker, and session service all use `userId` as the terminal
// partition. `clientId` remains a per-tab request validator/routing
// identifier, but it must not decide session visibility or lifecycle
// fanout.
export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, sessionService, isValidTerminalClientId } = deps

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
      const result = await manager.attachSession(userId, input.terminalRuntimeSessionId, input.cols, input.rows, terminalClientId)
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
      const terminalClientId = input.clientId ?? clientId
      const result = await manager.restartSession(userId, terminalRuntimeSessionId, input.cols, input.rows, terminalClientId)
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
      if (!isCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)) {
        return { ok: false, message: 'error.repo-instance-stale' }
      }
      const result = await sessionService.create(clientId, userId, input)
      if (result.ok) broadcastRepoWorkspaceTabsChanged(userId, input.repoRoot)
      return result
    },

    async replaceTabs(
      clientId: string,
      userId: string,
      input: TerminalReplaceWorkspaceTabsInput,
    ): Promise<WorkspacePaneTabEntry[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(input?.repoRoot)) return []
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return []
      assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      const tabs = await sessionService.replaceTabs(userId, input)
      broadcastRepoWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: TerminalUpdateWorkspaceTabsInput,
    ): Promise<WorkspacePaneTabEntry[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(input?.repoRoot)) return []
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return []
      assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      const tabs = await sessionService.updateTabs(userId, input)
      broadcastRepoWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
    },

    async prune(clientId: string, userId: string, input: TerminalPruneInput): Promise<{ pruned: number; remaining: number }> {
      if (!isValidTerminalClientId(clientId)) return { pruned: 0, remaining: 0 }
      if (!isValidRepoLocator(input.repoRoot)) return { pruned: 0, remaining: 0 }
      assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      return await sessionService.prune(clientId, userId, input.repoRoot, input.repoInstanceId)
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
      if (!isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) || !isValidTerminalSize(input?.cols, input?.rows)) {
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
      if (!isValidTerminalRuntimeSessionId(input?.terminalRuntimeSessionId) || !isValidTerminalSize(input?.cols, input?.rows)) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.takeoverSession(userId, input.terminalRuntimeSessionId, input.cols, input.rows, terminalClientId)
    },

    async listSessions(clientId: string, userId: string, input: TerminalListSessionsInput): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(input.repoRoot)) return []
      assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      return await sessionService.listSessions(userId, input.repoRoot, input.repoInstanceId)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: TerminalListWorkspaceTabsInput,
    ): Promise<WorkspacePaneTabsEntry[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(input.repoRoot)) return []
      assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)
      return await sessionService.listWorkspaceTabs(userId, input.repoRoot, input.repoInstanceId)
    },

  }

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', repoRoot })
  }

  function broadcastRepoWorkspaceTabsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'workspace-tabs-changed', repoRoot })
  }

  function assertCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): void {
    if (!isCurrentRepoInstance(userId, repoRoot, repoInstanceId)) {
      throw new Error('error.repo-instance-stale')
    }
  }

  function isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean {
    return isCurrentRepoRuntimeInstance(userId, repoRoot, repoInstanceId)
  }
}
