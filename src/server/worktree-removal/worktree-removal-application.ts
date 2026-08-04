import type { RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionExecutionPath } from '#/server/terminal/terminal-session-scope.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { PhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { serverLogger } from '#/server/logger.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeCapture } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { isRepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import { isRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

const worktreeRemovalLogger = serverLogger.child({ module: 'worktree-removal-application' })

interface WorktreeRemovalTerminalSessions {
  closeSessionsForPhysicalWorktree: TerminalSessionManager<string>['closeSessionsForPhysicalWorktree']
}

interface WorktreeRemovalWorkspaceTabs {
  physicalWorktreeTargets: WorkspacePaneTabsCoordinator['physicalWorktreeTargets']
  clearPhysicalWorktreeIndex: WorkspacePaneTabsCoordinator['clearPhysicalWorktreeIndex']
}

interface WorktreeRemovalApplicationDependencies {
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: PhysicalWorktreeCapture
  terminalSessions: WorktreeRemovalTerminalSessions
  workspaceTabs: WorktreeRemovalWorkspaceTabs
  isCurrentWorkspaceRuntime(userId: string, repoRoot: WorkspaceId, workspaceRuntimeId: string): boolean
  broadcastSessionsChanged(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): void
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: WorkspaceId): void
}

export class WorktreeRemovalApplication {
  private readonly deps: WorktreeRemovalApplicationDependencies

  constructor(deps: WorktreeRemovalApplicationDependencies) {
    this.deps = deps
  }

  async removeWorktree(
    userId: string,
    input: {
      repoRoot: WorkspaceId
      workspaceRuntimeId: string
      worktreePath: string
      branchName: string
      deleteBranch: boolean
      signal?: AbortSignal
      remove(
        capability: PhysicalWorktreeExecutionCapability,
        lifecycle: RepoWorktreeRemovalLifecycle,
        signal: AbortSignal,
      ): Promise<RepoMutationResult>
    },
  ): Promise<RepoMutationResult> {
    if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.workspace-runtime-stale' }
    const worktreePath = terminalSessionExecutionPath(input.repoRoot, input.worktreePath)
    let physicalCapability: PhysicalWorktreeExecutionCapability
    try {
      physicalCapability = await this.deps.physicalWorktrees.capture({
        userId,
        workspaceId: input.repoRoot,
        workspaceRuntimeId: input.workspaceRuntimeId,
        worktreePath,
      })
    } catch (error) {
      if (isRemoteWorkspaceRuntimeFailure(error)) throw error
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    try {
      const result = await this.deps.worktreeOperations.runRemoval(
        physicalCapability,
        async ({ signal }, permit) => {
          if (!this.isCurrentRuntime(userId, input)) return { ok: false, message: 'error.workspace-runtime-stale' }
          signal.throwIfAborted()
          let affectedScopes: Array<{
            userId: string
            repoRoot: WorkspaceId
            workspaceRuntimeId: string
            scope: string
            worktreePath: string
          }> = []
          return await input.remove(
            physicalCapability,
            {
              beforeRemove: async () => {
                signal.throwIfAborted()
                if (!this.isCurrentRuntime(userId, input))
                  return { ok: false, message: 'error.workspace-runtime-stale' }
                const quiescence = await this.quiesce(input.repoRoot, worktreePath, physicalCapability)
                signal.throwIfAborted()
                affectedScopes = quiescence.scopes
                if (!quiescence.ok) return { ok: false, message: quiescence.message }
                return { ok: true, message: '' }
              },
              afterWorktreeRemoved: async () => {
                try {
                  this.deps.worktreeOperations.assertPermit(physicalCapability, permit)
                  // Reverse-index refs only identify stale runtime scopes. They
                  // cannot authorize durable retirement: a stable target may
                  // already be rebound under a newer admission lease.
                  await this.deps.workspaceTabs.clearPhysicalWorktreeIndex(physicalCapability)
                  this.broadcastWorkspaceTabChanges(affectedScopes)
                  return { ok: true, message: '' }
                } catch (error) {
                  worktreeRemovalLogger.error({ error, repoRoot: input.repoRoot, worktreePath }, 'tabs finalize failed')
                  this.broadcastWorkspaceTabChanges(affectedScopes)
                  return {
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                  }
                }
              },
            },
            signal,
          )
        },
        input.signal,
      )
      if (!result.admitted) return { ok: false, message: 'error.worktree-removal-in-progress' }
      return result.value
    } catch (error) {
      // Runtime lifecycle settlement belongs to the request application
      // boundary. Re-throw both carriers so this workflow cannot become a
      // second settlement owner or discard a carrier's mutation facts.
      if (isRepoMutationRuntimeFailureError(error) || isRemoteWorkspaceRuntimeFailure(error)) throw error
      if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
      return { ok: false, message: abortMessage(error) }
    }
  }

  private isCurrentRuntime(userId: string, input: { repoRoot: WorkspaceId; workspaceRuntimeId: string }): boolean {
    return this.deps.isCurrentWorkspaceRuntime(userId, input.repoRoot, input.workspaceRuntimeId)
  }

  private async quiesce(
    repoRoot: WorkspaceId,
    worktreePath: string,
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
  ): Promise<
    | {
        ok: true
        scopes: Array<{
          userId: string
          repoRoot: WorkspaceId
          workspaceRuntimeId: string
          scope: string
          worktreePath: string
        }>
      }
    | {
        ok: false
        scopes: Array<{
          userId: string
          repoRoot: WorkspaceId
          workspaceRuntimeId: string
          scope: string
          worktreePath: string
        }>
        message: string
      }
  > {
    const targets = this.deps.workspaceTabs.physicalWorktreeTargets(physicalWorktreeCapability)
    const terminal = await this.deps.terminalSessions.closeSessionsForPhysicalWorktree(physicalWorktreeCapability)
    const terminalScopes = terminal.scopes.map((terminalScope) => ({
      userId: terminalScope.userId,
      repoRoot: terminalScope.workspaceId,
      workspaceRuntimeId: terminalScope.workspaceRuntimeId,
      scope: terminalScope.scope,
      worktreePath,
    }))
    // Terminal closure is authoritative even when a later closure, caller
    // cancellation, or Git removal fails. Publish it at the quiescence owner.
    this.broadcastSessionChanges(terminalScopes)
    const scopes = uniqueScopes([
      ...terminalScopes,
      ...targets.map(({ userId, scope, target }) => ({
        userId,
        repoRoot: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
        scope,
        worktreePath: target.kind === 'git-worktree' ? nativeTargetPath(target.root) : worktreePath,
      })),
    ])
    return terminal.ok ? { ok: true, scopes } : { ok: false, scopes, message: terminal.message }
  }

  private broadcastSessionChanges(
    scopes: readonly { userId: string; repoRoot: WorkspaceId; workspaceRuntimeId: string; scope: string }[],
  ): void {
    const targets = new Map(
      scopes.map(({ userId, repoRoot, workspaceRuntimeId, scope }) => [
        `${userId}\0${scope}`,
        { userId, repoRoot, workspaceRuntimeId },
      ]),
    )
    for (const { userId, repoRoot, workspaceRuntimeId } of targets.values()) {
      this.deps.broadcastSessionsChanged(userId, repoRoot, workspaceRuntimeId)
    }
  }

  private broadcastWorkspaceTabChanges(
    scopes: readonly { userId: string; repoRoot: WorkspaceId; workspaceRuntimeId: string; scope: string }[],
  ): void {
    const targets = new Map(scopes.map(({ userId, repoRoot }) => [`${userId}\0${repoRoot}`, { userId, repoRoot }]))
    for (const { userId, repoRoot } of targets.values()) {
      this.deps.broadcastWorkspaceTabsChanged(userId, repoRoot)
    }
  }
}

function nativeTargetPath(root: string): string {
  const locator = parseCanonicalWorkspaceLocator(root)
  if (!locator) throw new Error('error.workspace-tabs-target-invalid')
  return locator.path
}

function abortMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'error.workspace-runtime-stale') return error.message
  return error instanceof Error && error.name !== 'AbortError' ? error.message : 'error.workspace-runtime-stale'
}

export function createWorktreeRemovalApplication(
  deps: WorktreeRemovalApplicationDependencies,
): WorktreeRemovalApplication {
  return new WorktreeRemovalApplication(deps)
}

function uniqueScopes(
  scopes: readonly {
    userId: string
    repoRoot: WorkspaceId
    workspaceRuntimeId: string
    scope: string
    worktreePath: string
  }[],
): Array<{ userId: string; repoRoot: WorkspaceId; workspaceRuntimeId: string; scope: string; worktreePath: string }> {
  return Array.from(
    new Map(
      scopes.map((item) => [`${item.userId}\0${item.scope}\0${item.repoRoot}\0${item.worktreePath}`, item]),
    ).values(),
  )
}
