import { isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalRestartInput,
  TerminalResizeInput,
  TerminalSlotInput,
  TerminalSlotSnapshot,
  TerminalSlotSnapshotInput,
  TerminalSlotSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import {
  isValidTerminalPtySessionId,
  isValidTerminalSize,
} from '#/shared/terminal-validators.ts'
import { isValidTerminalClientId } from '#/server/terminal/terminal-runtime-support.ts'
import type { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import { isValidTerminalWriteData, type TerminalSlotManager } from '#/server/terminal/terminal-session-manager.ts'

interface TerminalCatalogLike {
  create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult>
  prune(clientId: string, userId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }>
  listSessions(userId: string, repoRoot: string): Promise<TerminalSlotSummary[]>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSlotManager<string>
  broker: Pick<TerminalRealtimeBroker, 'broadcastToOwner'>
  catalog: TerminalCatalogLike
  isValidTerminalClientId(value: unknown): value is string
  resolveAttachmentConnected(userId: string, clientId?: string): boolean | undefined
}

// Manager, broker, and catalog all use `userId` as the terminal
// partition. `clientId` remains a per-tab request validator/routing
// identifier, but it must not decide session visibility or lifecycle
// fanout.
export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, catalog, isValidTerminalClientId, resolveAttachmentConnected } = deps

  return {
    async attach(clientId: string, userId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const slotClientId = input.clientId ?? clientId
      const result = await manager.attachSession(
        userId,
        input.ptySessionId,
        input.cols,
        input.rows,
        slotClientId,
        resolveAttachmentConnected(userId, slotClientId),
      )
      return result
    },

    async restart(clientId: string, userId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
      const repoRoot = manager.getSlot(userId, input.ptySessionId)?.scope
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const slotClientId = input.clientId ?? clientId
      const result = await manager.restartSession(
        userId,
        input.ptySessionId,
        input.cols,
        input.rows,
        slotClientId,
        resolveAttachmentConnected(userId, slotClientId),
      )
      if (repoRoot) broadcastRepoSessionsChanged(userId, repoRoot)
      return result
    },

    async create(
      clientId: string,
      userId: string,
      input: TerminalCreateInput,
    ): Promise<TerminalCatalogMutationResult> {
      return await catalog.create(clientId, userId, input)
    },

    async prune(clientId: string, userId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
      return await catalog.prune(clientId, userId, repoRoot)
    },

    write(clientId: string, userId: string, input: TerminalWriteInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalWriteData(input?.data)
      ) {
        return false
      }
      const slotClientId = input.clientId ?? clientId
      return manager.writeSlot(userId, input.ptySessionId, input.data, slotClientId)
    },

    resize(clientId: string, userId: string, input: TerminalResizeInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return false
      }
      const slotClientId = input.clientId ?? clientId
      return manager.resizeSlot(
        userId,
        input.ptySessionId,
        input.cols,
        input.rows,
        slotClientId,
        resolveAttachmentConnected(userId, slotClientId),
      )
    },

    close(clientId: string, userId: string, input: TerminalSlotInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      // Look up the session BEFORE closing so we know its scope
      // (for the per-session broadcast). The session is gone after
      // `closeSlotForUser` returns, so a post-close lookup would
      // always miss. The lookup is also gated on validity so a
      // malformed input never throws inside the action.
      const repoRoot = isValidTerminalPtySessionId(input?.ptySessionId)
        ? manager.getSlot(userId, input.ptySessionId)?.scope
        : undefined
      const closed = isValidTerminalPtySessionId(input?.ptySessionId)
        ? manager.closeSlotForUser(userId, input.ptySessionId)
        : false
      if (closed && repoRoot) {
        // `sessions-changed` keeps the full repo list in sync for
        // observers that only watch that primitive. `session-closed`
        // is the immediate invalidation for any sibling window under
        // the same owner. Other owners must not hear about this
        // session id.
        broadcastRepoSessionsChanged(userId, repoRoot)
        broker.broadcastToOwner(userId, {
          type: 'slot-closed',
          ptySessionId: input.ptySessionId,
          repoRoot,
        })
      }
      return closed
    },

    takeover(clientId: string, userId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalPtySessionId(input?.ptySessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const slotClientId = input.clientId ?? clientId
      return manager.takeoverSlot(
        userId,
        input.ptySessionId,
        input.cols,
        input.rows,
        slotClientId,
        resolveAttachmentConnected(userId, slotClientId),
      )
    },

    async listSessions(clientId: string, userId: string, repoRoot: string): Promise<TerminalSlotSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(repoRoot)) return []
      return await catalog.listSessions(userId, repoRoot)
    },

    async getSlotSnapshot(
      clientId: string,
      userId: string,
      input: TerminalSlotSnapshotInput,
    ): Promise<TerminalSlotSnapshot | null> {
      if (!isValidTerminalClientId(clientId)) return null
      if (!isValidTerminalPtySessionId(input?.ptySessionId)) return null
      return await manager.getSlotSnapshot(userId, input.ptySessionId)
    },

  }

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToOwner(userId, { type: 'sessions-changed', repoRoot })
  }
}
