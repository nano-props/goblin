import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import {
  type TerminalCreateAction,
  type TerminalCreateResult,
  type TerminalCreateInput,
  type TerminalSessionSummary,
  type TerminalSessionsSnapshot,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import { isValidTerminalClientId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionRuntimeScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import {
  isValidWorkspacePaneTabsOperation,
  type WorkspacePaneTabsCoordinator,
  type WorkspacePaneRuntimeTabsProvider,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsRestoreResult } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import {
  createTerminalSessionEnsurer,
  type TerminalSessionEnsureInput,
  type TerminalSessionEnsureManager,
  type TerminalSessionEnsureResult,
  type TerminalSessionEnsurerOptions,
} from '#/server/terminal/terminal-session-ensurer.ts'
import { createTerminalSessionPruner } from '#/server/terminal/terminal-session-pruner.ts'
import { createTerminalSessionCreator } from '#/server/terminal/terminal-session-creator.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

interface TerminalSessionServiceManager extends TerminalSessionEnsureManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  terminalSessionsSnapshotForUser(userId: string, scope: string): TerminalSessionsSnapshot
  closeSession(terminalRuntimeSessionId: string): Promise<boolean>
}

interface TerminalSessionServiceOptions {
  isValidClientId(value: unknown): value is string
  isValidTerminalSessionId(value: unknown): value is string
  manager: TerminalSessionServiceManager
  workspaceTabsCoordinator: WorkspacePaneTabsCoordinator
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  gCommand?: TerminalSessionEnsurerOptions['gCommand']
}

type TerminalSessionCreateCoordinator = ReturnType<typeof createTerminalSessionCreateCoordinator>
type TerminalSessionCreator = ReturnType<typeof createTerminalSessionCreator>
type TerminalSessionEnsurer = ReturnType<typeof createTerminalSessionEnsurer>
type TerminalSessionPruner = ReturnType<typeof createTerminalSessionPruner>
class TerminalSessionService {
  private readonly options: TerminalSessionServiceOptions
  private readonly createCoordinator: TerminalSessionCreateCoordinator
  private readonly creator: TerminalSessionCreator
  private readonly ensurer: TerminalSessionEnsurer
  private readonly pruner: TerminalSessionPruner
  private readonly workspaceTabsCoordinator: WorkspacePaneTabsCoordinator

  constructor(options: TerminalSessionServiceOptions) {
    this.options = options
    this.createCoordinator = createTerminalSessionCreateCoordinator({ manager: options.manager })
    this.ensurer = createTerminalSessionEnsurer({
      manager: options.manager,
      broadcastSessionsChanged: options.broadcastSessionsChanged,
      gCommand: options.gCommand,
    })
    this.pruner = createTerminalSessionPruner({ manager: options.manager })
    this.workspaceTabsCoordinator = options.workspaceTabsCoordinator
    this.creator = createTerminalSessionCreator({
      createCoordinator: this.createCoordinator,
      ensureOrRestore: async (clientId, userId, input, physicalWorktreeCapability, signal) =>
        await this.ensureOrRestore(clientId, userId, input, physicalWorktreeCapability, signal),
      isCurrentRepoRuntime: (userId, repoRoot, repoRuntimeId) =>
        this.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId),
      rejectStaleCreateIfNeeded: async (userId, input, terminalRuntimeSessionId) =>
        await this.rejectStaleCreateIfNeeded(userId, input, terminalRuntimeSessionId),
    })
  }

  async ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    signal: AbortSignal,
  ): Promise<TerminalSessionEnsureResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }

    const terminalSessionId = input.terminalSessionId ?? createTerminalSessionId()
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    if (!this.options.isValidTerminalSessionId(terminalSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalSize(cols, rows)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
    const scopedWorktreePath = terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    const existingSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    const existingSession = existingSessions.find(
      (session) => session.terminalSessionId === terminalSessionId && session.worktreePath === scopedWorktreePath,
    )
    const action: TerminalCreateAction = existingSession
      ? existingSession.controller
        ? 'restored'
        : 'reused'
      : 'created'

    return await this.ensurer.ensure(userId, input, {
      terminalSessionId,
      cols,
      rows,
      scopedWorktreePath,
      physicalWorktreeCapability,
      action,
      signal,
    })
  }

  async createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    signal: AbortSignal,
  ): Promise<TerminalCreateResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
    const terminalClientId = input.clientId ?? clientId
    if (!isValidTerminalClientId(terminalClientId)) return { ok: false, message: 'error.invalid-arguments' }

    return await this.creator.create({
      clientId,
      terminalClientId,
      userId,
      request: input,
      physicalWorktreeCapability,
      signal,
    })
  }

  async replaceTabs(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      branchName: string
      worktreePath: string | null
      tabs: readonly WorkspacePaneTabEntry[]
    },
  ): Promise<WorkspacePaneTabsSnapshot> {
    if (!isValidRepoLocator(input.repoRoot)) return emptyWorkspacePaneTabsSnapshot()
    if (!isValidBranch(input.branchName)) return emptyWorkspacePaneTabsSnapshot()
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return emptyWorkspacePaneTabsSnapshot()
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
    const worktreePath =
      input.worktreePath === null ? null : terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    const result = await this.workspaceTabsCoordinator.replaceTabs({
      userId,
      repoRoot: input.repoRoot,
      scope,
      branchName: input.branchName,
      worktreePath,
      tabs: input.tabs,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId),
    })
    this.broadcastDurableLayoutChange(input.repoRoot, result.affectedUserIds)
    return result.snapshot
  }

  async restoreTabs(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      targets: WorkspacePaneTabsTarget[]
      expectedRepoEntry: RepoSessionEntry
    },
  ): Promise<WorkspacePaneTabsRestoreResult> {
    if (!isValidRepoLocator(input.repoRoot)) {
      return { kind: 'restored', snapshot: emptyWorkspacePaneTabsSnapshot(), repaired: false }
    }
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
    const result = await this.workspaceTabsCoordinator.restoreScope({
      userId,
      repoRoot: input.repoRoot,
      scope,
      targets: input.targets.map((target) => ({
        ...target,
        worktreePath: target.worktreePath === null
          ? null
          : terminalSessionWorktreePath(input.repoRoot, target.worktreePath),
      })),
      expectedRepoEntry: input.expectedRepoEntry,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId),
    })
    if (result.kind === 'membership-conflict') return result
    this.broadcastDurableLayoutChange(input.repoRoot, result.affectedUserIds)
    return { kind: 'restored', snapshot: result.snapshot, repaired: result.repaired }
  }

  async updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabsSnapshot> {
    if (!isValidRepoLocator(input.repoRoot)) return emptyWorkspacePaneTabsSnapshot()
    if (!isValidBranch(input.branchName)) return emptyWorkspacePaneTabsSnapshot()
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return emptyWorkspacePaneTabsSnapshot()
    if (!isValidWorkspacePaneTabsOperation(input.operation)) return emptyWorkspacePaneTabsSnapshot()
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
    const worktreePath =
      input.worktreePath === null ? null : terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    const result = await this.workspaceTabsCoordinator.updateTabs({
      userId,
      repoRoot: input.repoRoot,
      scope,
      branchName: input.branchName,
      worktreePath,
      operation: input.operation,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId),
    })
    this.broadcastDurableLayoutChange(input.repoRoot, result.affectedUserIds)
    return result.snapshot
  }

  async retireTarget(
    userId: string,
    input: { repoRuntimeId: string; target: WorkspacePaneTabsTargetIdentity },
  ): Promise<void> {
    const { repoRoot } = input.target
    const validTarget =
      input.target.kind === 'branch' ? isValidBranch(input.target.branchName) : isValidCwd(input.target.worktreePath)
    if (!isValidRepoLocator(repoRoot) || !validTarget) {
      throw new Error('invalid workspace pane target')
    }
    const scope = terminalSessionRuntimeScope(repoRoot, input.repoRuntimeId)
    const result = await this.workspaceTabsCoordinator.retireTarget({
      userId,
      scope,
      target: input.target,
    })
    this.broadcastDurableLayoutChange(repoRoot, result.affectedUserIds)
  }

  async reconcileTerminalTabsForSession(userId: string, session: TerminalSessionSummary): Promise<void> {
    const scope = terminalSessionRuntimeScope(session.repoRoot, session.repoRuntimeId)
    await this.workspaceTabsCoordinator.reconcileWorktree({
      userId,
      repoRoot: session.repoRoot,
      scope,
      worktreePath: session.worktreePath,
    })
  }

  async listWorkspaceTabs(userId: string, repoRoot: string, repoRuntimeId: string): Promise<WorkspacePaneTabsSnapshot> {
    if (!isValidRepoLocator(repoRoot)) return emptyWorkspacePaneTabsSnapshot()
    const scope = terminalSessionRuntimeScope(repoRoot, repoRuntimeId)
    return await this.workspaceTabsCoordinator.listWorkspaceTabs({
      userId,
      repoRoot,
      scope,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, repoRoot, repoRuntimeId),
    })
  }

  async listSessions(userId: string, repoRoot: string, repoRuntimeId: string): Promise<TerminalSessionSummary[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    return await this.options.manager.listSessionsForUser(userId, terminalSessionRuntimeScope(repoRoot, repoRuntimeId))
  }

  async prune(
    clientId: string,
    userId: string,
    repoRoot: string,
    repoRuntimeId: string,
  ): Promise<{ pruned: number; remaining: number }> {
    if (!this.options.isValidClientId(clientId)) return { pruned: 0, remaining: 0 }
    if (!isValidRepoLocator(repoRoot)) return { pruned: 0, remaining: 0 }

    const sessionScope = terminalSessionRuntimeScope(repoRoot, repoRuntimeId)
    return await this.pruner.prune({
      userId,
      repoRoot,
      scope: sessionScope,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, repoRoot, repoRuntimeId),
    })
  }

  private isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
    return this.options.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)
  }

  private assertCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): void {
    if (!this.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)) throw new Error('error.repo-runtime-stale')
  }

  private broadcastDurableLayoutChange(repoRoot: string, affectedUserIds: readonly string[]): void {
    for (const affectedUserId of affectedUserIds) {
      this.options.broadcastWorkspaceTabsChanged(affectedUserId, repoRoot)
    }
  }

  private async rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoRuntimeId'>,
    terminalRuntimeSessionId: string,
  ): Promise<Extract<TerminalCreateResult, { ok: false }> | null> {
    if (this.isCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)) return null
    await this.options.manager.closeSession(terminalRuntimeSessionId)
    return { ok: false, message: 'error.repo-runtime-stale' }
  }
}

export function createTerminalSessionService(options: TerminalSessionServiceOptions): TerminalSessionService {
  return new TerminalSessionService(options)
}

export function terminalWorkspacePaneRuntimeTabsProvider(
  manager: Pick<TerminalSessionServiceManager, 'terminalSessionsSnapshotForUser'>,
  captureSnapshot: (userId: string, scope: string) => Promise<TerminalSessionsSnapshot> = async (userId, scope) =>
    manager.terminalSessionsSnapshotForUser(userId, scope),
): WorkspacePaneRuntimeTabsProvider {
  return {
    type: 'terminal',
    async captureSnapshotForUser(userId, scope) {
      const snapshot = await captureSnapshot(userId, scope)
      return {
        revision: snapshot.revision,
        liveSessions: snapshot.sessions.map((session) => ({
          sessionId: session.terminalSessionId,
          branch: session.branch,
          worktreePath: session.worktreePath,
        })),
      }
    },
  }
}

function emptyWorkspacePaneTabsSnapshot(): WorkspacePaneTabsSnapshot {
  return { revision: 0, entries: [] }
}
