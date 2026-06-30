import { isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalRestartInput,
  TerminalResizeInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import { isValidTerminalPtySessionId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import type { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'

interface TerminalCatalogLike {
  create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult>
  prune(clientId: string, userId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }>
  listSessions(userId: string, repoRoot: string): Promise<TerminalSessionSummary[]>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSessionManager<string>
  broker: Pick<TerminalRealtimeBroker, 'broadcastToUser'>
  catalog: TerminalCatalogLike
  isValidTerminalClientId(value: unknown): value is string
}

// Manager, broker, and catalog all use `userId` as the terminal
// partition. `clientId` remains a per-tab request validator/routing
// identifier, but it must not decide session visibility or lifecycle
// fanout.
export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, catalog, isValidTerminalClientId } = deps

  return {
    async attach(clientId: string, userId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const terminalClientId = input.clientId ?? clientId
      const result = await manager.attachSession(userId, input.ptySessionId, input.cols, input.rows, terminalClientId)
      return result
    },

    async restart(clientId: string, userId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
      const ptySessionId = input?.ptySessionId
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalPtySessionId(ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const repoRoot = manager.getSessionScope(userId, ptySessionId)
      const terminalClientId = input.clientId ?? clientId
      const result = await manager.restartSession(userId, ptySessionId, input.cols, input.rows, terminalClientId)
      if (repoRoot) broadcastRepoSessionsChanged(userId, repoRoot)
      return result
    },

    async create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
      return await catalog.create(clientId, userId, input)
    },

    async prune(clientId: string, userId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
      return await catalog.prune(clientId, userId, repoRoot)
    },

    write(clientId: string, userId: string, input: TerminalWriteInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (!isValidTerminalPtySessionId(input?.ptySessionId) || !isValidTerminalWriteData(input?.data)) {
        return false
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.writeSession(userId, input.ptySessionId, input.data, terminalClientId)
    },

    resize(clientId: string, userId: string, input: TerminalResizeInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (!isValidTerminalPtySessionId(input?.ptySessionId) || !isValidTerminalSize(input?.cols, input?.rows)) {
        return false
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.resizeSession(userId, input.ptySessionId, input.cols, input.rows, terminalClientId)
    },

    close(clientId: string, userId: string, input: TerminalSessionInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      // Look up the session BEFORE closing so we know its scope
      // (for the per-session broadcast). The session is gone after
      // `closeSessionForUser` returns, so a post-close lookup would
      // always miss. The lookup is also gated on validity so a
      // malformed input never throws inside the action.
      const repoRoot = isValidTerminalPtySessionId(input?.ptySessionId)
        ? manager.getSessionScope(userId, input.ptySessionId)
        : undefined
      const closed = isValidTerminalPtySessionId(input?.ptySessionId)
        ? manager.closeSessionForUser(userId, input.ptySessionId)
        : false
      if (closed && repoRoot) {
        // `sessions-changed` keeps the full repo list in sync for
        // observers that only watch that primitive. `session-closed`
        // is the immediate invalidation for any sibling window under
        // the same user. Other users must not hear about this
        // session id.
        broadcastRepoSessionsChanged(userId, repoRoot)
        broker.broadcastToUser(userId, {
          type: 'session-closed',
          ptySessionId: input.ptySessionId,
          repoRoot,
        })
      }
      return closed
    },

    takeover(clientId: string, userId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (!isValidTerminalPtySessionId(input?.ptySessionId) || !isValidTerminalSize(input?.cols, input?.rows)) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const terminalClientId = input.clientId ?? clientId
      return manager.takeoverSession(userId, input.ptySessionId, input.cols, input.rows, terminalClientId)
    },

    async listSessions(clientId: string, userId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(repoRoot)) return []
      return await catalog.listSessions(userId, repoRoot)
    },

    async getSessionSnapshot(
      clientId: string,
      userId: string,
      input: TerminalSessionSnapshotInput,
    ): Promise<TerminalSessionSnapshot | null> {
      if (!isValidTerminalClientId(clientId)) return null
      if (!isValidTerminalPtySessionId(input?.ptySessionId)) return null
      return await manager.getSessionSnapshot(userId, input.ptySessionId)
    },
  }

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', repoRoot })
  }
}
