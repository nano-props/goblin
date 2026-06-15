import path from 'node:path'
import { isValidRepoLocator } from '#/shared/input-validation.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { terminalSessionScope } from '#/shared/terminal-session-key.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalReorderInput,
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
  create(clientId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult>
  prune(clientId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }>
  listSessions(repoRoot: string): Promise<TerminalSessionSummary[]>
}

interface TerminalRuntimeActionDependencies {
  manager: TerminalSessionManager<string>
  broker: Pick<TerminalRealtimeBroker, 'broadcastGlobal'>
  catalog: TerminalCatalogLike
  isValidTerminalClientId(value: unknown): value is string
  resolveAttachmentConnected(clientId: string, attachmentId?: string): boolean | undefined
}

export function createTerminalRuntimeActions(deps: TerminalRuntimeActionDependencies) {
  const { manager, broker, catalog, isValidTerminalClientId, resolveAttachmentConnected } = deps

  return {
    async attach(clientId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const result = manager.attachSession(
        clientId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(clientId, input.attachmentId),
      )
      return result
    },

    async restart(clientId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
      const repoRoot = manager.getSession(clientId, input.sessionId)?.scope
      if (
        !isValidTerminalClientId(clientId) ||
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      const result = await manager.restartSession(
        clientId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(clientId, input.attachmentId),
      )
      if (repoRoot) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
      return result
    },

    async create(clientId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
      return await catalog.create(clientId, input)
    },

    async prune(clientId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
      return await catalog.prune(clientId, repoRoot)
    },

    write(clientId: string, input: TerminalWriteInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalWriteData(input?.data) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return false
      }
      return manager.writeSession(clientId, input.sessionId, input.data, input.attachmentId)
    },

    resize(clientId: string, input: TerminalResizeInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return false
      }
      return manager.resizeSession(
        clientId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(clientId, input.attachmentId),
      )
    },

    close(clientId: string, input: TerminalSessionInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      const repoRoot = isValidTerminalSessionId(input?.sessionId)
        ? manager.getSession(clientId, input.sessionId)?.scope
        : undefined
      const closed = isValidTerminalSessionId(input?.sessionId)
        ? manager.closeOwnedSession(clientId, input.sessionId)
        : false
      if (closed && repoRoot) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
      return closed
    },

    takeover(clientId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
      if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
      if (
        !isValidTerminalSessionId(input?.sessionId) ||
        !isValidTerminalSize(input?.cols, input?.rows) ||
        !isValidTerminalAttachmentId(input?.attachmentId)
      ) {
        return { ok: false, message: 'error.invalid-arguments' }
      }
      return manager.takeoverSession(
        clientId,
        input.sessionId,
        input.cols,
        input.rows,
        input.attachmentId,
        resolveAttachmentConnected(clientId, input.attachmentId),
      )
    },

    async listSessions(clientId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
      if (!isValidTerminalClientId(clientId)) return []
      if (!isValidRepoLocator(repoRoot)) return []
      return await catalog.listSessions(repoRoot)
    },

    getSessionSnapshot(clientId: string, input: TerminalSessionSnapshotInput): TerminalSessionSnapshot | null {
      if (!isValidTerminalClientId(clientId)) return null
      if (!isValidTerminalSessionId(input?.sessionId)) return null
      return manager.snapshotSession(input.sessionId)
    },

    reorder(clientId: string, input: TerminalReorderInput): TerminalMutationResult {
      if (!isValidTerminalClientId(clientId)) return false
      if (!isValidRepoLocator(input?.repoRoot)) return false
      if (typeof input?.worktreePath !== 'string' || input.worktreePath.length === 0) return false
      if (!Array.isArray(input?.orderedKeys)) return false
      if (!input.orderedKeys.every((k) => typeof k === 'string' && k.length > 0)) return false
      // Normalize the scope/worktreePath the same way the catalog does, so
      // manager.reorderSessions sees the canonical forms it stored on
      // each session. Without this, Windows forward-slash paths never
      // match the resolved back-slash form and the reorder silently
      // no-ops.
      const scope = terminalSessionScope(input.repoRoot)
      const worktreePath = isRemoteRepoId(input.repoRoot) ? input.worktreePath : path.resolve(input.worktreePath)
      const reordered = manager.reorderSessions(scope, worktreePath, input.orderedKeys)
      if (reordered) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot: input.repoRoot })
      return reordered
    },
  }
}
