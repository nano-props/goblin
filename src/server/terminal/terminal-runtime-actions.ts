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
import {
  isValidTerminalAttachmentId,
  isValidTerminalSessionId,
  isValidTerminalSize,
} from '#/shared/terminal-validators.ts'
import type { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'

interface TerminalCatalogLike {
  create(clientId: string, ownerId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult>
  prune(clientId: string, ownerId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }>
  listSessions(ownerId: string, repoRoot: string): Promise<TerminalSessionSummary[]>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSessionManager<string>
  broker: Pick<TerminalRealtimeBroker, 'broadcastToOwner'>
  catalog: TerminalCatalogLike
  isValidTerminalClientId(value: unknown): value is string
  resolveAttachmentConnected(ownerId: string, attachmentId?: string): boolean | undefined
}

// Manager, broker, and catalog all use `ownerId` as the terminal
// partition. `clientId` remains a per-tab request validator/routing
// identifier, but it must not decide session visibility or lifecycle
// fanout.
export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, catalog, isValidTerminalClientId, resolveAttachmentConnected } = deps

  return {
    async attach(clientId: string, ownerId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const result = await manager.attachSession(
        ownerId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(ownerId, input.attachmentId),
      )
      return result
    },

    async restart(clientId: string, ownerId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
      const repoRoot = manager.getSession(ownerId, input.sessionId)?.scope
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const result = await manager.restartSession(
        ownerId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(ownerId, input.attachmentId),
      )
      if (repoRoot) broadcastRepoSessionsChanged(ownerId, repoRoot)
      return result
    },

    async create(
      clientId: string,
      ownerId: string,
      input: TerminalCreateInput,
    ): Promise<TerminalCatalogMutationResult> {
      return await catalog.create(clientId, ownerId, input)
    },

    async prune(clientId: string, ownerId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
      return await catalog.prune(clientId, ownerId, repoRoot)
    },

    write(clientId: string, ownerId: string, input: TerminalWriteInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalWriteData(input?.data) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return false
      }
      return manager.writeSession(ownerId, input.sessionId, input.data, input.attachmentId)
    },

    resize(clientId: string, ownerId: string, input: TerminalResizeInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return false
      }
      return manager.resizeSession(
        ownerId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(ownerId, input.attachmentId),
      )
    },

    close(clientId: string, ownerId: string, input: TerminalSessionInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      // Look up the session BEFORE closing so we know its scope
      // (for the per-session broadcast). The session is gone after
      // `closeSessionForOwner` returns, so a post-close lookup would
      // always miss. The lookup is also gated on validity so a
      // malformed input never throws inside the action.
      const repoRoot = isValidTerminalSessionId(input?.sessionId)
        ? manager.getSession(ownerId, input.sessionId)?.scope
        : undefined
      const closed = isValidTerminalSessionId(input?.sessionId)
        ? manager.closeSessionForOwner(ownerId, input.sessionId)
        : false
      if (closed && repoRoot) {
        // `sessions-changed` keeps the full repo list in sync for
        // observers that only watch that primitive. `session-closed`
        // is the immediate invalidation for any sibling window under
        // the same owner. Other owners must not hear about this
        // session id.
        broadcastRepoSessionsChanged(ownerId, repoRoot)
        broker.broadcastToOwner(ownerId, {
          type: 'session-closed',
          sessionId: input.sessionId,
          repoRoot,
        })
      }
      return closed
    },

    takeover(clientId: string, ownerId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      return manager.takeoverSession(
        ownerId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(ownerId, input.attachmentId),
      )
    },

    async listSessions(clientId: string, ownerId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(repoRoot)) return []
      return await catalog.listSessions(ownerId, repoRoot)
    },

    async getSessionSnapshot(
      clientId: string,
      ownerId: string,
      input: TerminalSessionSnapshotInput,
    ): Promise<TerminalSessionSnapshot | null> {
      if (!isValidTerminalClientId(clientId)) return null
      if (!isValidTerminalSessionId(input?.sessionId)) return null
      return await manager.getSessionSnapshot(ownerId, input.sessionId)
    },

  }

  function broadcastRepoSessionsChanged(ownerId: string, repoRoot: string): void {
    broker.broadcastToOwner(ownerId, { type: 'sessions-changed', repoRoot })
  }
}
