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
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { failRemoteRuntimeIfNeeded } from '#/server/modules/remote-runtime-failure-settlement.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const worktreeRemovalLogger = serverLogger.child({ module: 'worktree-removal-application' })

interface WorktreeRemovalApplicationDependencies {
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  terminalWorktree: Pick<TerminalSessionManager<string>, 'closeSessionsForPhysicalWorktree'>
  workspaceTabs: Pick<
    WorkspacePaneTabsCoordinator,
    'physicalWorktreeTargets' | 'reconcilePhysicalWorktreeAfterRemovalFailure' | 'clearPhysicalWorktreeIndex'
  >
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  broadcastSessionsChanged(userId: string, repoRoot: string, repoRuntimeId: string): void
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
      branchName: string
      deleteBranch: boolean
      signal?: AbortSignal
      remove(
        capability: PhysicalWorktreeExecutionCapability,
        lifecycle: RepoWorktreeRemovalLifecycle,
        signal: AbortSignal,
      ): Promise<ExecResult>
    },
  ): Promise<ExecResult> {
    if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
    const worktreePath = terminalSessionWorktreePath(input.repoRoot, input.worktreePath)
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.deps.physicalWorktrees.capture({
        userId,
        repoRoot: input.repoRoot,
        repoRuntimeId: input.repoRuntimeId,
        worktreePath,
      })
    } catch (error) {
      failRemoteRuntimeIfNeeded(userId, error)
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    try {
      const result = await this.deps.worktreeOperations.runRemoval(
        physicalCapability,
        async ({ signal }, permit) => {
          if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.repo-runtime-stale' }
          signal.throwIfAborted()
          let affectedScopes: Array<{
            userId: string
            repoRoot: string
            repoRuntimeId: string
            scope: string
            worktreePath: string
          }> = []
          return await input.remove(
            physicalCapability,
            {
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
                  this.deps.worktreeOperations.assertPermit(physicalCapability, permit)
                  // Reverse-index refs only identify stale runtime scopes. They
                  // cannot authorize durable retirement: a stable target may
                  // already be rebound to a new physical generation.
                  await this.deps.workspaceTabs.clearPhysicalWorktreeIndex(physicalCapability)
                  this.broadcast(affectedScopes)
                  return { ok: true, message: '' }
                } catch (error) {
                  worktreeRemovalLogger.error({ error, repoRoot: input.repoRoot, worktreePath }, 'tabs finalize failed')
                  this.broadcast(affectedScopes)
                  return {
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                    repositoryStateChanged: true,
                  }
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
            },
            signal,
          )
        },
        input.signal,
      )
      if (!result.admitted) return { ok: false, message: 'error.worktree-removal-in-progress' }
      return result.value
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
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
  ): Promise<
    | {
        ok: true
        scopes: Array<{ userId: string; repoRoot: string; repoRuntimeId: string; scope: string; worktreePath: string }>
      }
    | {
        ok: false
        scopes: Array<{ userId: string; repoRoot: string; repoRuntimeId: string; scope: string; worktreePath: string }>
        message: string
      }
  > {
    const targets = this.deps.workspaceTabs.physicalWorktreeTargets(physicalWorktreeCapability)
    const terminal = await this.deps.terminalWorktree.closeSessionsForPhysicalWorktree(physicalWorktreeCapability)
    const scopes = uniqueScopes([
      ...terminal.scopes.map((item) => ({ ...item, worktreePath })),
      ...targets.map(({ userId, scope, target }) => ({
        userId,
        repoRoot: target.workspaceId,
        repoRuntimeId: target.workspaceRuntimeId,
        scope,
        worktreePath: target.kind === 'git-worktree' ? nativeTargetPath(target.root) : worktreePath,
      })),
    ])
    return terminal.ok ? { ok: true, scopes } : { ok: false, scopes, message: terminal.message }
  }

  private broadcast(
    scopes: readonly { userId: string; repoRoot: string; repoRuntimeId: string; scope: string }[],
  ): void {
    const targets = new Map(
      scopes.map(({ userId, repoRoot, repoRuntimeId, scope }) => [
        `${userId}\0${scope}`,
        { userId, repoRoot, repoRuntimeId },
      ]),
    )
    for (const { userId, repoRoot, repoRuntimeId } of targets.values()) {
      this.deps.broadcastSessionsChanged(userId, repoRoot, repoRuntimeId)
      this.deps.broadcastWorkspaceTabsChanged(userId, repoRoot)
    }
  }

  private async reconcileAfterFailure(
    repoRoot: string,
    worktreePath: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
    permit: PhysicalWorktreeOperationPermit,
    scopes: readonly {
      userId: string
      repoRoot: string
      repoRuntimeId: string
      scope: string
      worktreePath: string
    }[],
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
    this.broadcast(scopes)
  }
}

function nativeTargetPath(root: string): string {
  const locator = parseCanonicalWorkspaceLocator(root)
  if (!locator) throw new Error('error.workspace-tabs-target-invalid')
  return locator.path
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

function uniqueScopes(
  scopes: readonly {
    userId: string
    repoRoot: string
    repoRuntimeId: string
    scope: string
    worktreePath: string
  }[],
): Array<{ userId: string; repoRoot: string; repoRuntimeId: string; scope: string; worktreePath: string }> {
  return Array.from(
    new Map(
      scopes.map((item) => [`${item.userId}\0${item.scope}\0${item.repoRoot}\0${item.worktreePath}`, item]),
    ).values(),
  )
}
