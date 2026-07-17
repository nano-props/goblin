import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import {
  type TerminalCreateResult,
  type TerminalCreateInput,
  type TerminalSessionSummary,
  type TerminalSessionsSnapshot,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsReplaceInput,
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
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { bindWorkspacePaneTarget, type RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { canonicalWorkspaceLocator, parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
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
import {
  createTerminalSessionCreator,
  type ServerTerminalCreateResult,
} from '#/server/terminal/terminal-session-creator.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'

interface TerminalSessionServiceManager extends TerminalSessionEnsureManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  terminalSessionsSnapshotForUser(userId: string, scope: string): TerminalSessionsSnapshot
  requestSessionRetirement(terminalRuntimeSessionId: string): Promise<boolean>
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
    if (input.target?.kind !== 'workspace' && !isValidBranch(input.branch)) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }

    const terminalSessionId = input.terminalSessionId ?? createTerminalSessionId()
    const cols = input.cols ?? 80
    const rows = input.rows ?? 24
    if (!this.options.isValidTerminalSessionId(terminalSessionId))
      return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidTerminalSize(cols, rows)) return { ok: false, message: 'error.invalid-arguments' }

    const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoRuntimeId)
    const scopedWorktreePath = terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    return await this.ensurer.ensure(userId, input, {
      terminalSessionId,
      cols,
      rows,
      scopedWorktreePath,
      physicalWorktreeCapability,
      signal,
    })
  }

  async createAdmitted(
    clientId: string,
    userId: string,
    input: TerminalCreateInput,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    signal: AbortSignal,
  ): Promise<ServerTerminalCreateResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (input.target?.kind !== 'workspace' && !isValidBranch(input.branch)) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
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

  async replaceTabs(userId: string, input: WorkspacePaneTabsReplaceInput): Promise<WorkspacePaneTabsSnapshot> {
    const nativeWorktreePath = nativeWorktreePathForRuntimeTarget(input.target)
    if (
      nativeWorktreePath === undefined ||
      input.workspaceId !== input.target.workspaceId ||
      input.workspaceRuntimeId !== input.target.workspaceRuntimeId
    ) {
      return emptyWorkspacePaneTabsSnapshot()
    }
    const scope = terminalSessionRuntimeScope(input.workspaceId, input.workspaceRuntimeId)
    const worktreePath =
      nativeWorktreePath === null ? null : terminalSessionWorktreePath(input.workspaceId, nativeWorktreePath)
    const result = await this.workspaceTabsCoordinator.replaceTabs({
      userId,
      repoRoot: input.workspaceId,
      scope,
      target: input.target,
      nativeWorktreePath: worktreePath,
      tabs: input.tabs,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId),
    })
    this.broadcastDurableLayoutChange(input.workspaceId, result.affectedUserIds)
    return result.snapshot
  }

  async restoreTabs(
    userId: string,
    input: {
      workspaceId: string
      workspaceRuntimeId: string
      targets: RestorableWorkspacePaneTarget[]
      expectedRepoEntry: WorkspaceSessionEntry
    },
  ): Promise<WorkspacePaneTabsRestoreResult> {
    if (!isValidRepoLocator(input.workspaceId)) {
      return { kind: 'restored', snapshot: emptyWorkspacePaneTabsSnapshot(), repaired: false }
    }
    const workspaceId = canonicalWorkspaceLocator(input.workspaceId)
    if (!workspaceId) return { kind: 'restored', snapshot: emptyWorkspacePaneTabsSnapshot(), repaired: false }
    const scope = terminalSessionRuntimeScope(input.workspaceId, input.workspaceRuntimeId)
    const result = await this.workspaceTabsCoordinator.restoreScope({
      userId,
      repoRoot: input.workspaceId,
      scope,
      targets: input.targets.flatMap((restorable) => {
        const nativePath = nativeWorktreePathForRestorableTarget(workspaceId, restorable)
        if (nativePath === undefined) return []
        return [
          {
            target: bindWorkspacePaneTarget(restorable, workspaceId, input.workspaceRuntimeId),
            nativeWorktreePath:
              nativePath === null || nativePath === input.workspaceId
                ? nativePath
                : terminalSessionWorktreePath(input.workspaceId, nativePath),
            canonicalBranch: restorable.kind === 'git-branch' ? restorable.branch : null,
          },
        ]
      }),
      expectedRepoEntry: input.expectedRepoEntry,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId),
    })
    if (result.kind === 'membership-conflict') return result
    this.broadcastDurableLayoutChange(input.workspaceId, result.affectedUserIds)
    return { kind: 'restored', snapshot: result.snapshot, repaired: false }
  }

  async updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabsSnapshot> {
    const nativeWorktreePath = nativeWorktreePathForRuntimeTarget(input.target)
    if (
      nativeWorktreePath === undefined ||
      input.workspaceId !== input.target.workspaceId ||
      input.workspaceRuntimeId !== input.target.workspaceRuntimeId
    ) {
      return emptyWorkspacePaneTabsSnapshot()
    }
    if (!isValidWorkspacePaneTabsOperation(input.operation)) return emptyWorkspacePaneTabsSnapshot()
    const scope = terminalSessionRuntimeScope(input.workspaceId, input.workspaceRuntimeId)
    const worktreePath =
      nativeWorktreePath === null || nativeWorktreePath === input.workspaceId
        ? nativeWorktreePath
        : terminalSessionWorktreePath(input.workspaceId, nativeWorktreePath)
    const result = await this.workspaceTabsCoordinator.updateTabs({
      userId,
      repoRoot: input.workspaceId,
      scope,
      target: input.target,
      nativeWorktreePath: worktreePath,
      operation: input.operation,
      assertCurrent: () => this.assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId),
    })
    this.broadcastDurableLayoutChange(input.workspaceId, result.affectedUserIds)
    return result.snapshot
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
          target: session.target,
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

function nativeWorktreePathForRuntimeTarget(
  target: WorkspacePaneTabsReplaceInput['target'],
): string | null | undefined {
  if (!restorableWorkspacePaneTargetFromRuntime(target)) return undefined
  if (target.kind === 'workspace') return parseCanonicalWorkspaceLocator(target.workspaceId)?.path
  if (target.kind === 'git-branch') return null
  return parseCanonicalWorkspaceLocator(target.root)?.path
}

function nativeWorktreePathForRestorableTarget(
  workspaceId: WorkspacePaneTabsReplaceInput['target']['workspaceId'],
  target: RestorableWorkspacePaneTarget,
): string | null | undefined {
  if (target.kind === 'workspace') return parseCanonicalWorkspaceLocator(workspaceId)?.path
  if (target.kind === 'git-branch') return null
  const runtime = bindWorkspacePaneTarget(target, workspaceId, 'restore-validation')
  if (!restorableWorkspacePaneTargetFromRuntime(runtime)) return undefined
  return parseCanonicalWorkspaceLocator(target.root)?.path
}
