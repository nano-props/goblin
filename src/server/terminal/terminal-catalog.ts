import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  type TerminalAttachResult,
  type TerminalCatalogAction,
  type TerminalCatalogMutationResult,
  type TerminalControllerStatus,
  type TerminalCreateInput,
  type TerminalSessionPhase,
  type TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { formatTerminalSessionId, parseTerminalSessionIdIndex } from '#/shared/terminal-session-id-format.ts'
import { isValidTerminalClientId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import { formatTerminalWorkspaceSlotKey, parseTerminalWorkspaceSlotKey } from '#/shared/terminal-workspace-slot-key.ts'
import { terminalSessionScope } from '#/server/terminal/terminal-session-scope.ts'
import {
  buildGoblinTerminalCommandEnvironment,
  type GoblinTerminalCommandRuntime,
} from '#/server/terminal/g-command.ts'

interface EnsureTerminalCatalogInput {
  repoRoot: string
  branch: string
  worktreePath: string
  sessionId?: string
  cols?: number
  rows?: number
  clientId?: string
}

// Internal-only shape for the catalog's ensure/restore result. The
// wire contract is `TerminalCatalogMutationResult`; this richer
// payload is used to ferry attach metadata between the catalog's
// private helpers. Do not export.
type EnsureTerminalCatalogResult =
  | {
      ok: true
      ptySessionId: string
      key: string
      action: TerminalCatalogAction
      processName: string
      canonicalTitle: string | null
      phase: TerminalSessionPhase
      message: string | null
      snapshot: string
      snapshotSeq: number
      controller: { clientId: string; status: Exclude<TerminalControllerStatus, 'none'> } | null
      canonicalCols: number
      canonicalRows: number
    }
  | { ok: false; message: string }

interface TerminalCatalogEnsureSessionInput {
  userId: string
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  clientId?: string
  clientConnected?: boolean
  forceNew?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
}

interface TerminalCatalogManager {
  ensureSession(input: TerminalCatalogEnsureSessionInput): Promise<TerminalAttachResult>
  listSessionsForUser(userId: string, repoRoot: string): Promise<TerminalSessionSummary[]>
  closeSession(ptySessionId: string): void
}

interface TerminalCatalogOptions {
  isValidClientId(value: unknown): value is string
  isValidTerminalSessionId(value: unknown): value is string
  manager: TerminalCatalogManager
  isClientConnected(userId: string, clientId?: string): boolean | undefined
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  gCommand?: GoblinTerminalCommandRuntime
}

class TerminalCatalog {
  private readonly options: TerminalCatalogOptions

  constructor(options: TerminalCatalogOptions) {
    this.options = options
  }

  async ensureOrRestore(
    clientId: string,
    userId: string,
    input: EnsureTerminalCatalogInput,
  ): Promise<EnsureTerminalCatalogResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionId = input.sessionId ?? formatTerminalSessionId(1)
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    if (!this.options.isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalSize(cols, rows)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionScope = terminalSessionScope(input.repoRoot)
    const existingSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    // Build the target session key from the same form the manager uses
    // to scope user-scoped session lists — see the comment on
    // `terminalSessionScope` in server/terminal/terminal-session-scope.ts
    // for the normalization rationale.
    const targetWorkspaceSlotKey = formatTerminalWorkspaceSlotKey(
      sessionScope,
      isRemoteRepoId(input.repoRoot) ? input.worktreePath : path.resolve(input.worktreePath),
      sessionId,
    )
    const existingSession = existingSessions.find((session) => session.key === targetWorkspaceSlotKey)
    const action: TerminalCatalogAction = existingSession
      ? existingSession.controller
        ? 'restored'
        : 'reused'
      : 'created'

    if (isRemoteRepoId(input.repoRoot)) {
      return await this.ensureRemote(userId, input, { sessionId, cols, rows, targetSlotKey: targetWorkspaceSlotKey, action })
    }
    return await this.ensureLocal(userId, input, { cols, rows, targetSlotKey: targetWorkspaceSlotKey, action })
  }

  async create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    const terminalClientId = input.clientId ?? clientId
    if (!isValidTerminalClientId(terminalClientId)) return { ok: false, message: 'error.invalid-arguments' }

    const createResult = await this.ensureOrRestore(clientId, userId, {
      ...input,
      clientId: terminalClientId,
      sessionId:
        input.kind === 'primary' ? 'session-1' : await this.nextSessionId(userId, input.repoRoot, input.worktreePath),
    })
    if (!createResult.ok) return { ok: false, message: createResult.message }
    return {
      ok: true,
      action: createResult.action,
      key: createResult.key,
      ptySessionId: createResult.ptySessionId,
      processName: createResult.processName,
      canonicalTitle: createResult.canonicalTitle,
      phase: createResult.phase,
      message: createResult.message,
      snapshot: createResult.snapshot,
      snapshotSeq: createResult.snapshotSeq,
      controller: createResult.controller,
      canonicalCols: createResult.canonicalCols,
      canonicalRows: createResult.canonicalRows,
      sessions: await this.listSessions(userId, input.repoRoot),
    }
  }

  async listSessions(userId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    return await this.options.manager.listSessionsForUser(userId, terminalSessionScope(repoRoot))
  }

  async prune(clientId: string, userId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
    if (!this.options.isValidClientId(clientId)) return { pruned: 0, remaining: 0 }
    if (!isValidRepoLocator(repoRoot)) return { pruned: 0, remaining: 0 }

    const sessionScope = terminalSessionScope(repoRoot)
    const allSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    if (isRemoteRepoId(repoRoot)) return { pruned: 0, remaining: allSessions.length }

    const worktrees = await getWorktrees(repoRoot, { includeStatus: false })
    const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
    let pruned = 0
    for (const session of allSessions) {
      const parsed = parseTerminalWorkspaceSlotKey(session.key)
      if (!parsed) continue
      if (path.resolve(parsed.repoRoot) !== path.resolve(repoRoot)) continue
      if (liveWorktreePaths.has(path.resolve(parsed.worktreePath))) continue
      this.options.manager.closeSession(session.ptySessionId)
      pruned += 1
    }
    if (pruned > 0) this.options.broadcastSessionsChanged(userId, repoRoot)
    const remaining = await this.options.manager
      .listSessionsForUser(userId, sessionScope)
      .then((sessions) => sessions.length)
    return { pruned, remaining }
  }

  async nextSessionId(userId: string, repoRoot: string, worktreePath: string): Promise<string> {
    // Compare against the canonical form so a forward-slash Windows path
    // matches the resolved back-slash form used as the session key prefix.
    const scopedRepoRoot = terminalSessionScope(repoRoot)
    const scopedWorktreePath = isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
    const sessions = await this.options.manager.listSessionsForUser(userId, scopedRepoRoot)
    let maxIndex = 0
    for (const session of sessions) {
      const parsed = parseTerminalWorkspaceSlotKey(session.key)
      if (!parsed || parsed.repoRoot !== scopedRepoRoot || parsed.worktreePath !== scopedWorktreePath) continue
      const index = parseTerminalSessionIdIndex(parsed.sessionId)
      if (index === null) continue
      if (index > maxIndex) maxIndex = index
    }
    return formatTerminalSessionId(maxIndex + 1)
  }

  private async ensureRemote(
    userId: string,
    input: EnsureTerminalCatalogInput,
    context: {
      sessionId: string
      cols: number
      rows: number
      targetSlotKey: string
      action: TerminalCatalogAction
    },
  ): Promise<EnsureTerminalCatalogResult> {
    const ref = parseRemoteRepoId(input.repoRoot)
    if (!ref) return { ok: false, message: 'error.ssh-config-changed' }
    let resolved
    try {
      resolved = await resolveRemoteTarget(ref)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'error.ssh-config-changed' }
    }
    const invocation = buildRemoteTerminalInvocation(resolved.target, input.worktreePath, {
      cols: context.cols,
      rows: context.rows,
    })
    const result = await this.options.manager.ensureSession({
      userId,
      scope: input.repoRoot,
      key: context.targetSlotKey,
      cwd: process.cwd(),
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      clientConnected: this.options.isClientConnected(userId, input.clientId),
      forceNew: context.action === 'created',
      command: invocation.command,
      args: invocation.args,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.targetSlotKey, context.action, result)
  }

  private async ensureLocal(
    userId: string,
    input: EnsureTerminalCatalogInput,
    context: {
      cols: number
      rows: number
      targetSlotKey: string
      action: TerminalCatalogAction
    },
  ): Promise<EnsureTerminalCatalogResult> {
    const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
    const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
    if (!resolved.ok) return { ok: false, message: resolved.message }

    const repoRoot = path.resolve(input.repoRoot)
    const worktreePath = path.resolve(resolved.path)
    const env = this.options.gCommand
      ? (buildGoblinTerminalCommandEnvironment({
          ...this.options.gCommand,
          repoRoot,
          worktreePath,
        }) ?? undefined)
      : undefined
    const result = await this.options.manager.ensureSession({
      userId,
      scope: repoRoot,
      key: context.targetSlotKey,
      cwd: worktreePath,
      cols: context.cols,
      rows: context.rows,
      clientId: input.clientId,
      clientConnected: this.options.isClientConnected(userId, input.clientId),
      forceNew: context.action === 'created',
      env,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(userId, input.repoRoot)
    return toEnsureResult(context.targetSlotKey, context.action, result)
  }
}

function toEnsureResult(
  key: string,
  action: TerminalCatalogAction,
  snapshotResult: Extract<TerminalAttachResult, { ok: true }>,
): EnsureTerminalCatalogResult {
  return {
    ok: true,
    ptySessionId: snapshotResult.ptySessionId,
    key,
    action,
    processName: snapshotResult.processName,
    canonicalTitle: snapshotResult.canonicalTitle,
    phase: snapshotResult.phase,
    message: snapshotResult.message,
    snapshot: snapshotResult.snapshot,
    snapshotSeq: snapshotResult.snapshotSeq,
    controller: snapshotResult.controller,
    canonicalCols: snapshotResult.canonicalCols,
    canonicalRows: snapshotResult.canonicalRows,
  }
}

export function createTerminalCatalog(options: TerminalCatalogOptions): TerminalCatalog {
  return new TerminalCatalog(options)
}
