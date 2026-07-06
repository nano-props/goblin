import path from 'node:path'
import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  type TerminalCreateAction,
  type TerminalCreateResult,
  type TerminalCreateInput,
  type TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsUpdateInput } from '#/shared/workspace-pane-tabs.ts'
import { isValidTerminalClientId, isValidTerminalSize } from '#/shared/terminal-validators.ts'
import { createTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import {
  isValidWorkspacePaneTabsOperation,
  type WorkspacePaneTabsCoordinator,
  type WorkspacePaneRuntimeTabsProvider,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
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

interface TerminalSessionServiceManager extends TerminalSessionEnsureManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  closeSession(terminalRuntimeSessionId: string): void
}

interface TerminalSessionServiceOptions {
  isValidClientId(value: unknown): value is string
  isValidTerminalSessionId(value: unknown): value is string
  manager: TerminalSessionServiceManager
  workspaceTabs: Pick<
    WorkspacePaneTabsRuntime<string>,
    'closeTabsForScope'
  >
  workspaceTabsCoordinator: WorkspacePaneTabsCoordinator
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
  isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean
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
      workspaceTabsCoordinator: this.workspaceTabsCoordinator,
      ensureOrRestore: async (clientId, userId, input) => await this.ensureOrRestore(clientId, userId, input),
      isCurrentRepoInstance: (userId, repoRoot, repoInstanceId) =>
        this.isCurrentRepoInstance(userId, repoRoot, repoInstanceId),
      rejectStaleCreateIfNeeded: (userId, input, terminalRuntimeSessionId) =>
        this.rejectStaleCreateIfNeeded(userId, input, terminalRuntimeSessionId),
      listSessions: async (userId, repoRoot, repoInstanceId) =>
        await this.listSessions(userId, repoRoot, repoInstanceId),
    })
  }

  async ensureOrRestore(
    clientId: string,
    userId: string,
    input: TerminalSessionEnsureInput,
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

    const sessionScope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const scopedWorktreePath = terminalWorktreePath(input.repoRoot, input.worktreePath)
    const existingSessions = await this.options.manager.listSessionsForUser(userId, sessionScope)
    const existingSession = existingSessions.find(
      (session) => session.terminalSessionId === terminalSessionId && session.worktreePath === scopedWorktreePath,
    )
    const action: TerminalCreateAction = existingSession
      ? existingSession.controller
        ? 'restored'
        : 'reused'
      : 'created'

    return await this.ensurer.ensure(userId, input, { terminalSessionId, cols, rows, scopedWorktreePath, action })
  }

  async create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult> {
    if (!this.options.isValidClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidRepoLocator(input.repoRoot)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidBranch(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (!isValidCwd(input.worktreePath)) return { ok: false, message: 'error.invalid-arguments' }
    const terminalClientId = input.clientId ?? clientId
    if (!isValidTerminalClientId(terminalClientId)) return { ok: false, message: 'error.invalid-arguments' }

    return await this.creator.create({ clientId, terminalClientId, userId, request: input })
  }

  async replaceTabs(
    userId: string,
    input: {
      repoRoot: string
      repoInstanceId: string
      branchName: string
      worktreePath: string | null
      tabs: readonly WorkspacePaneTabEntry[]
    },
  ): Promise<WorkspacePaneTabEntry[]> {
    if (!isValidRepoLocator(input.repoRoot)) return []
    if (!isValidBranch(input.branchName)) return []
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return []
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const worktreePath = input.worktreePath === null ? null : terminalWorktreePath(input.repoRoot, input.worktreePath)
    return await this.workspaceTabsCoordinator.replaceTabs({
      userId,
      scope,
      branchName: input.branchName,
      worktreePath,
      tabs: input.tabs,
      assertCurrent: () => this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId),
    })
  }

  async updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabEntry[]> {
    if (!isValidRepoLocator(input.repoRoot)) return []
    if (!isValidBranch(input.branchName)) return []
    if (input.worktreePath !== null && !isValidCwd(input.worktreePath)) return []
    if (!isValidWorkspacePaneTabsOperation(input.operation)) return []
    const scope = terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId)
    const worktreePath = input.worktreePath === null ? null : terminalWorktreePath(input.repoRoot, input.worktreePath)
    return await this.workspaceTabsCoordinator.updateTabs({
      userId,
      scope,
      branchName: input.branchName,
      worktreePath,
      operation: input.operation,
      assertCurrent: () => this.assertCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId),
    })
  }

  async reconcileTerminalTabsForSession(userId: string, session: TerminalSessionSummary): Promise<void> {
    const scope = terminalSessionRuntimeScope(session.repoRoot, session.repoInstanceId)
    await this.workspaceTabsCoordinator.reconcileWorktree({ userId, scope, worktreePath: session.worktreePath })
  }

  async listWorkspaceTabs(userId: string, repoRoot: string, repoInstanceId: string): Promise<WorkspacePaneTabsEntry[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    const scope = terminalSessionRuntimeScope(repoRoot, repoInstanceId)
    return await this.workspaceTabsCoordinator.listWorkspaceTabs({
      userId,
      repoRoot,
      scope,
      assertCurrent: () => this.assertCurrentRepoInstance(userId, repoRoot, repoInstanceId),
      broadcastChanged: () => this.options.broadcastWorkspaceTabsChanged(userId, repoRoot),
    })
  }

  async listSessions(userId: string, repoRoot: string, repoInstanceId: string): Promise<TerminalSessionSummary[]> {
    if (!isValidRepoLocator(repoRoot)) return []
    return await this.options.manager.listSessionsForUser(userId, terminalSessionRuntimeScope(repoRoot, repoInstanceId))
  }

  async prune(
    clientId: string,
    userId: string,
    repoRoot: string,
    repoInstanceId: string,
  ): Promise<{ pruned: number; remaining: number }> {
    if (!this.options.isValidClientId(clientId)) return { pruned: 0, remaining: 0 }
    if (!isValidRepoLocator(repoRoot)) return { pruned: 0, remaining: 0 }

    const sessionScope = terminalSessionRuntimeScope(repoRoot, repoInstanceId)
    return await this.pruner.prune({
      userId,
      repoRoot,
      scope: sessionScope,
      assertCurrent: () => this.assertCurrentRepoInstance(userId, repoRoot, repoInstanceId),
    })
  }

  private isCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean {
    return this.options.isCurrentRepoInstance(userId, repoRoot, repoInstanceId)
  }

  private assertCurrentRepoInstance(userId: string, repoRoot: string, repoInstanceId: string): void {
    if (!this.isCurrentRepoInstance(userId, repoRoot, repoInstanceId)) throw new Error('error.repo-instance-stale')
  }

  private rejectStaleCreateIfNeeded(
    userId: string,
    input: Pick<TerminalCreateInput, 'repoRoot' | 'repoInstanceId'>,
    terminalRuntimeSessionId: string,
  ): Extract<TerminalCreateResult, { ok: false }> | null {
    if (this.isCurrentRepoInstance(userId, input.repoRoot, input.repoInstanceId)) return null
    this.options.manager.closeSession(terminalRuntimeSessionId)
    this.options.workspaceTabs.closeTabsForScope(
      userId,
      terminalSessionRuntimeScope(input.repoRoot, input.repoInstanceId),
    )
    return { ok: false, message: 'error.repo-instance-stale' }
  }
}

export function createTerminalSessionService(options: TerminalSessionServiceOptions): TerminalSessionService {
  return new TerminalSessionService(options)
}

function terminalWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}

export function terminalWorkspacePaneRuntimeTabsProvider(
  manager: Pick<TerminalSessionServiceManager, 'listSessionsForUser'>,
): WorkspacePaneRuntimeTabsProvider {
  return {
    type: 'terminal',
    async listSessionsForUser(userId, scope) {
      return (await manager.listSessionsForUser(userId, scope)).map((session) => ({
        sessionId: session.terminalSessionId,
        branch: session.branch,
        worktreePath: session.worktreePath,
      }))
    },
  }
}
