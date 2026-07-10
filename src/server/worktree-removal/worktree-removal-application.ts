import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { PhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { serverLogger } from '#/server/logger.ts'

const worktreeRemovalLogger = serverLogger.child({ module: 'worktree-removal-application' })

interface WorktreeRemovalApplicationDependencies {
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  terminalWorktree: Pick<TerminalSessionManager<string>, 'closeSessionsForPhysicalWorktree'>
  workspaceTabs: Pick<
    WorkspacePaneTabsCoordinator,
    'finalizePhysicalWorktreeRemoval' | 'physicalWorktreeScopes' | 'reconcilePhysicalWorktreeAfterRemovalFailure'
  >
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  broadcastSessionsChanged(userId: string, repoRoot: string): void
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
}

export class WorktreeRemovalApplication {
  private readonly deps: WorktreeRemovalApplicationDependencies

  constructor(deps: WorktreeRemovalApplicationDependencies) {
    this.deps = deps
  }

  async removeWorktree(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      worktreePath: string
      remove(lifecycle: RepoWorktreeRemovalLifecycle): Promise<ExecResult>
    },
  ): Promise<ExecResult> {
    if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
    const worktreePath = terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    const operationTarget = { repoRoot: input.repoRoot, worktreePath }
    const result = await this.deps.worktreeOperations.runRemoval(operationTarget, async () => {
      if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
      let affectedScopes: Array<{ userId: string; scope: string }> = []
      return await input.remove({
        beforeRemove: async () => {
          if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
          const quiescence = await this.quiesce(input.repoRoot, worktreePath)
          affectedScopes = quiescence.scopes
          if (!quiescence.ok) {
            await this.reconcileAfterFailure(input.repoRoot, worktreePath, affectedScopes)
            return { ok: false, message: quiescence.message }
          }
          return { ok: true, message: '' }
        },
        afterWorktreeRemoved: async () => {
          try {
            await this.deps.workspaceTabs.finalizePhysicalWorktreeRemoval({
              worktreePath,
              scopes: affectedScopes,
            })
            this.broadcast(input.repoRoot, affectedScopes)
            return { ok: true, message: '' }
          } catch (error) {
            worktreeRemovalLogger.error({ error, repoRoot: input.repoRoot, worktreePath }, 'tabs finalize failed')
            this.broadcast(input.repoRoot, affectedScopes)
            return { ok: false, message: error instanceof Error ? error.message : String(error) }
          }
        },
        afterRemoveFailed: async () => await this.reconcileAfterFailure(input.repoRoot, worktreePath, affectedScopes),
      })
    })
    return result.admitted ? result.value : { ok: false, message: 'error.worktree-removal-in-progress' }
  }

  private isCurrentRuntime(userId: string, input: { repoRoot: string; repoRuntimeId: string }): boolean {
    return this.deps.isCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
  }

  private async quiesce(
    repoRoot: string,
    worktreePath: string,
  ): Promise<
    | { ok: true; scopes: Array<{ userId: string; scope: string }> }
    | { ok: false; scopes: Array<{ userId: string; scope: string }>; message: string }
  > {
    const terminal = await this.deps.terminalWorktree.closeSessionsForPhysicalWorktree(repoRoot, worktreePath)
    const scopes = uniqueScopes([
      ...terminal.scopes,
      ...this.deps.workspaceTabs.physicalWorktreeScopes({ repoRoot, worktreePath }),
    ])
    return terminal.ok ? { ok: true, scopes } : { ok: false, scopes, message: terminal.message }
  }

  private broadcast(repoRoot: string, scopes: readonly { userId: string; scope: string }[]): void {
    for (const userId of new Set(scopes.map((scope) => scope.userId))) {
      this.deps.broadcastSessionsChanged(userId, repoRoot)
      this.deps.broadcastWorkspaceTabsChanged(userId, repoRoot)
    }
  }

  private async reconcileAfterFailure(
    repoRoot: string,
    worktreePath: string,
    scopes: readonly { userId: string; scope: string }[],
  ): Promise<void> {
    try {
      await this.deps.workspaceTabs.reconcilePhysicalWorktreeAfterRemovalFailure({ repoRoot, worktreePath, scopes })
    } catch (error) {
      worktreeRemovalLogger.error({ error, repoRoot, worktreePath }, 'tabs reconcile failed')
    }
    this.broadcast(repoRoot, scopes)
  }
}

export function createWorktreeRemovalApplication(
  deps: WorktreeRemovalApplicationDependencies,
): WorktreeRemovalApplication {
  return new WorktreeRemovalApplication(deps)
}

function uniqueScopes(scopes: readonly { userId: string; scope: string }[]): Array<{ userId: string; scope: string }> {
  return Array.from(new Map(scopes.map((scope) => [`${scope.userId}\0${scope.scope}`, scope])).values())
}
