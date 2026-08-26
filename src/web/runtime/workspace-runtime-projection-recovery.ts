import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { TerminalProjectionRecoveryActions } from '#/web/runtime/app-terminal-projection-recovery.ts'
import type { RuntimeProjectionScopeRegistry, RuntimeProjectionTarget } from '#/web/runtime/runtime-projection-scope.ts'
import type { WorkspacePaneTabsRecoveryActions } from '#/web/runtime/workspace-pane-tabs-recovery.ts'

type WorkspaceRuntimeMembershipRecovery =
  { kind: 'superseded' } | { kind: 'settled'; targets: RuntimeProjectionTarget[] }

export interface WorkspaceRuntimeProjectionRecoveryDependencies {
  scopeRegistry: RuntimeProjectionScopeRegistry
  reconcileMemberships: () => Promise<WorkspaceRuntimeMembershipRecovery>
  currentWorkspaceRuntimeId: (workspaceId: WorkspaceId) => string | null
  terminalRecovery: TerminalProjectionRecoveryActions
  workspaceTabsRecovery: WorkspacePaneTabsRecoveryActions
  resyncRepoReads: () => Promise<void>
  setRecoveryFailed: (failed: boolean) => void
  logFailure: (error: unknown) => void
}

export class WorkspaceRuntimeProjectionRecovery {
  private readonly dependencies: WorkspaceRuntimeProjectionRecoveryDependencies
  private requestGeneration = 0

  constructor(dependencies: WorkspaceRuntimeProjectionRecoveryDependencies) {
    this.dependencies = dependencies
  }

  request(): void {
    const requestGeneration = ++this.requestGeneration
    this.dependencies.setRecoveryFailed(false)
    void this.run(requestGeneration)
  }

  invalidate(): void {
    this.requestGeneration += 1
    this.dependencies.setRecoveryFailed(false)
  }

  private async run(requestGeneration: number): Promise<void> {
    try {
      const recovery = await this.dependencies.reconcileMemberships()
      // Only the latest recovery may publish recovered projections.
      if (requestGeneration !== this.requestGeneration) return
      if (recovery.kind === 'superseded') {
        this.dependencies.setRecoveryFailed(false)
        return
      }
      this.dependencies.scopeRegistry.disposeScopes()
      for (const target of recovery.targets) {
        if (this.dependencies.currentWorkspaceRuntimeId(target.workspaceId) !== target.workspaceRuntimeId) continue
        const scope = this.dependencies.scopeRegistry.scopeFor(target)
        this.dependencies.terminalRecovery.begin(scope, { kind: 'reconnect' })
        this.dependencies.workspaceTabsRecovery.request(scope, { kind: 'fresh' })
      }
      await this.dependencies.resyncRepoReads()
      if (requestGeneration === this.requestGeneration) this.dependencies.setRecoveryFailed(false)
    } catch (error) {
      if (requestGeneration !== this.requestGeneration) return
      this.dependencies.setRecoveryFailed(true)
      this.dependencies.logFailure(error)
    }
  }
}
