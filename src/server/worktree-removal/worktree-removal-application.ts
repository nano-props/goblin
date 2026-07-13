import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  PhysicalWorktreeCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { failRemoteRuntimeIfNeeded } from '#/server/modules/remote-runtime-failure-settlement.ts'

const worktreeRemovalLogger = serverLogger.child({ module: 'worktree-removal-application' })

interface WorktreeRemovalApplicationDependencies {
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
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
      signal?: AbortSignal
      remove(
        capability: PhysicalWorktreeCapability,
        lifecycle: RepoWorktreeRemovalLifecycle,
        signal: AbortSignal,
      ): Promise<ExecResult>
    },
  ): Promise<ExecResult> {
    if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
    const worktreePath = terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    let physicalCapability: PhysicalWorktreeCapability
    try {
      physicalCapability = await this.deps.physicalWorktrees.capture({
        userId,
        repoRoot: input.repoRoot,
        repoRuntimeId: input.repoRuntimeId,
        worktreePath,
        refresh: true,
      })
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    try {
      const result = await this.deps.worktreeOperations.runRemoval(physicalCapability, async ({ signal }, permit) => {
        if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
        signal.throwIfAborted()
        let affectedScopes: Array<{ userId: string; scope: string }> = []
        return await input.remove(physicalCapability, {
          beforeRemove: async () => {
            signal.throwIfAborted()
            if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
            const quiescence = await this.quiesce(input.repoRoot, worktreePath, physicalCapability)
            signal.throwIfAborted()
            affectedScopes = quiescence.scopes
            if (!quiescence.ok) {
              await this.reconcileAfterFailure(
                input.repoRoot,
                worktreePath,
                physicalCapability,
                permit,
                affectedScopes,
              )
              return { ok: false, message: quiescence.message }
            }
            return { ok: true, message: '' }
          },
          afterWorktreeRemoved: async () => {
            try {
              await this.deps.workspaceTabs.finalizePhysicalWorktreeRemoval({
                worktreePath,
                physicalWorktreeCapability: physicalCapability,
                permit,
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
          afterRemoveFailed: async () =>
            await this.reconcileAfterFailure(
              input.repoRoot,
              worktreePath,
              physicalCapability,
              permit,
              affectedScopes,
            ),
        }, signal)
      }, input.signal)
      return result.admitted ? result.value : { ok: false, message: 'error.worktree-removal-in-progress' }
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return { ok: false, message: abortMessage(error) }
    }
  }

  private isCurrentRuntime(userId: string, input: { repoRoot: string; repoRuntimeId: string }): boolean {
    return this.deps.isCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
  }

  private async quiesce(
    repoRoot: string,
    worktreePath: string,
    physicalWorktreeCapability: PhysicalWorktreeCapability,
  ): Promise<
    | { ok: true; scopes: Array<{ userId: string; scope: string }> }
    | { ok: false; scopes: Array<{ userId: string; scope: string }>; message: string }
  > {
    const terminal = await this.deps.terminalWorktree.closeSessionsForPhysicalWorktree(physicalWorktreeCapability)
    const scopes = uniqueScopes([
      ...terminal.scopes,
      ...this.deps.workspaceTabs.physicalWorktreeScopes(physicalWorktreeCapability.identity),
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
    physicalWorktreeCapability: PhysicalWorktreeCapability,
    permit: PhysicalWorktreeOperationPermit,
    scopes: readonly { userId: string; scope: string }[],
  ): Promise<void> {
    try {
      await this.deps.workspaceTabs.reconcilePhysicalWorktreeAfterRemovalFailure({
        repoRoot,
        worktreePath,
        physicalWorktreeCapability,
        permit,
        scopes,
      })
    } catch (error) {
      worktreeRemovalLogger.error({ error, repoRoot, worktreePath }, 'tabs reconcile failed')
    }
    this.broadcast(repoRoot, scopes)
  }
}

function abortMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'error.repo-runtime-stale') return error.message
  return error instanceof Error && error.name !== 'AbortError' ? error.message : 'error.repo-runtime-stale'
}

export function createWorktreeRemovalApplication(
  deps: WorktreeRemovalApplicationDependencies,
): WorktreeRemovalApplication {
  return new WorktreeRemovalApplication(deps)
}

function uniqueScopes(scopes: readonly { userId: string; scope: string }[]): Array<{ userId: string; scope: string }> {
  return Array.from(new Map(scopes.map((scope) => [`${scope.userId}\0${scope.scope}`, scope])).values())
}
