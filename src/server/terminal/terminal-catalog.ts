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
  type TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { formatTerminalId, parseTerminalIdIndex } from '#/shared/terminal-ids.ts'
import { isValidTerminalAttachmentId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import {
  formatTerminalSessionKey,
  parseTerminalSessionKey,
  terminalSessionScope,
} from '#/shared/terminal-session-key.ts'

interface EnsureTerminalCatalogInput {
  repoRoot: string
  branch: string
  worktreePath: string
  terminalId?: string
  cols?: number
  rows?: number
  attachmentId?: string
}

// Internal-only shape for the catalog's ensure/restore result. The
// wire contract is `TerminalCatalogMutationResult`; this richer
// payload is used to ferry attach metadata between the catalog's
// private helpers. Do not export.
type EnsureTerminalCatalogResult =
  | {
      ok: true
      sessionId: string
      key: string
      action: TerminalCatalogAction
      processName: string
      canonicalTitle: string | null
      snapshot: string
      snapshotSeq: number
      controller: { attachmentId: string; status: Exclude<TerminalControllerStatus, 'none'> } | null
      canonicalCols?: number
      canonicalRows?: number
    }
  | { ok: false; message: string }

interface TerminalCatalogEnsureSessionInput {
  ownerId: string
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  attachmentId?: string
  attachmentConnected?: boolean
  forceNew?: boolean
  command?: string
  args?: string[]
}

interface TerminalCatalogManager {
  ensureSession(input: TerminalCatalogEnsureSessionInput): Promise<TerminalAttachResult>
  listSessions(repoRoot: string): Promise<TerminalSessionSummary[]>
  closeSession(sessionId: string): void
}

interface TerminalCatalogOptions {
  isValidClientId(value: unknown): value is string
  isValidTerminalId(value: unknown): value is string
  manager: TerminalCatalogManager
  attachmentIsConnected(clientId: string, attachmentId?: string): boolean | undefined
  broadcastSessionsChanged(repoRoot: string): void
}

class TerminalCatalog {
  private readonly options: TerminalCatalogOptions

  constructor(options: TerminalCatalogOptions) {
    this.options = options
  }

  async ensureOrRestore(clientId: string, input: EnsureTerminalCatalogInput): Promise<EnsureTerminalCatalogResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }

    const terminalId = input.terminalId ?? formatTerminalId(1)
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    if (!this.options.isValidTerminalId(terminalId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalSize(cols, rows)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionScope = terminalSessionScope(input.repoRoot)
    const existingSessions = await this.options.manager.listSessions(sessionScope)
    // Build the target session key from the same form the manager uses
    // to scope listSessions — see the comment on `terminalSessionScope`
    // in shared/terminal-session-key.ts for the normalization rationale.
    const targetSessionKey = formatTerminalSessionKey(
      sessionScope,
      isRemoteRepoId(input.repoRoot) ? input.worktreePath : path.resolve(input.worktreePath),
      terminalId,
    )
    const existingSession = existingSessions.find((session) => session.key === targetSessionKey)
    const action: TerminalCatalogAction = existingSession
      ? existingSession.controller
        ? 'restored'
        : 'reused'
      : 'created'

    if (isRemoteRepoId(input.repoRoot)) {
      return await this.ensureRemote(clientId, input, { terminalId, cols, rows, targetSessionKey, action })
    }
    return await this.ensureLocal(clientId, input, { cols, rows, targetSessionKey, action })
  }

  async create(clientId: string, input: TerminalCreateInput): Promise<TerminalCatalogMutationResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalAttachmentId(input?.attachmentId)) return { ok: false, message: 'error.invalid-arguments' }

    const createResult = await this.ensureOrRestore(clientId, {
      ...input,
      terminalId:
        input.kind === 'primary' ? 'terminal-1' : await this.nextTerminalId(input.repoRoot, input.worktreePath),
    })
    if (!createResult.ok) return { ok: false, message: createResult.message }
    return {
      ok: true,
      action: createResult.action,
      key: createResult.key,
      sessions: await this.listSessions(input.repoRoot),
    }
  }

  async listSessions(repoRoot: string): Promise<TerminalSessionSummary[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    return await this.options.manager.listSessions(terminalSessionScope(repoRoot))
  }

  async prune(clientId: string, repoRoot: string): Promise<{ pruned: number; remaining: number }> {
    if (!this.options.isValidClientId(clientId)) return { pruned: 0, remaining: 0 }
    if (!isValidRepoLocator(repoRoot)) return { pruned: 0, remaining: 0 }

    const sessionScope = terminalSessionScope(repoRoot)
    const allSessions = await this.options.manager.listSessions(sessionScope)
    if (isRemoteRepoId(repoRoot)) return { pruned: 0, remaining: allSessions.length }

    const worktrees = await getWorktrees(repoRoot, { includeStatus: false })
    const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
    let pruned = 0
    for (const session of allSessions) {
      const parsed = parseTerminalSessionKey(session.key)
      if (!parsed) continue
      if (path.resolve(parsed.repoRoot) !== path.resolve(repoRoot)) continue
      if (liveWorktreePaths.has(path.resolve(parsed.worktreePath))) continue
      this.options.manager.closeSession(session.sessionId)
      pruned += 1
    }
    if (pruned > 0) this.options.broadcastSessionsChanged(repoRoot)
    const remaining = await this.options.manager.listSessions(sessionScope).then((sessions) => sessions.length)
    return { pruned, remaining }
  }

  async nextTerminalId(repoRoot: string, worktreePath: string): Promise<string> {
    // Compare against the canonical form so a forward-slash Windows path
    // matches the resolved back-slash form used as the session key prefix.
    const scopedRepoRoot = terminalSessionScope(repoRoot)
    const scopedWorktreePath = isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
    const sessions = await this.options.manager.listSessions(scopedRepoRoot)
    let maxIndex = 0
    for (const session of sessions) {
      const parsed = parseTerminalSessionKey(session.key)
      if (!parsed || parsed.repoRoot !== scopedRepoRoot || parsed.worktreePath !== scopedWorktreePath) continue
      const index = parseTerminalIdIndex(parsed.terminalId)
      if (index === null) continue
      if (index > maxIndex) maxIndex = index
    }
    return formatTerminalId(maxIndex + 1)
  }

  private async ensureRemote(
    clientId: string,
    input: EnsureTerminalCatalogInput,
    context: {
      terminalId: string
      cols: number
      rows: number
      targetSessionKey: string
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
      ownerId: clientId,
      scope: input.repoRoot,
      key: context.targetSessionKey,
      cwd: process.cwd(),
      cols: context.cols,
      rows: context.rows,
      attachmentId: input.attachmentId,
      attachmentConnected: this.options.attachmentIsConnected(clientId, input.attachmentId),
      forceNew: context.action === 'created',
      command: invocation.command,
      args: invocation.args,
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(input.repoRoot)
    return toEnsureResult(context.targetSessionKey, context.action, result)
  }

  private async ensureLocal(
    clientId: string,
    input: EnsureTerminalCatalogInput,
    context: {
      cols: number
      rows: number
      targetSessionKey: string
      action: TerminalCatalogAction
    },
  ): Promise<EnsureTerminalCatalogResult> {
    const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
    const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
    if (!resolved.ok) return { ok: false, message: resolved.message }

    const repoRoot = path.resolve(input.repoRoot)
    const worktreePath = path.resolve(resolved.path)
    const result = await this.options.manager.ensureSession({
      ownerId: clientId,
      scope: repoRoot,
      key: context.targetSessionKey,
      cwd: worktreePath,
      cols: context.cols,
      rows: context.rows,
      attachmentId: input.attachmentId,
      attachmentConnected: this.options.attachmentIsConnected(clientId, input.attachmentId),
      forceNew: context.action === 'created',
    })
    if (!result.ok) return { ok: false, message: result.message }
    this.options.broadcastSessionsChanged(input.repoRoot)
    return toEnsureResult(context.targetSessionKey, context.action, result)
  }
}

function toEnsureResult(
  key: string,
  action: TerminalCatalogAction,
  snapshotResult: Extract<TerminalAttachResult, { ok: true }>,
): EnsureTerminalCatalogResult {
  return {
    ok: true,
    sessionId: snapshotResult.sessionId,
    key,
    action,
    processName: snapshotResult.processName,
    canonicalTitle: snapshotResult.canonicalTitle,
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
