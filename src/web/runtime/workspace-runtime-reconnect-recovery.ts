import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { TerminalProjectionRecoveryActions } from '#/web/runtime/app-terminal-projection-recovery.ts'
import type { RuntimeProjectionScopeRegistry, RuntimeProjectionTarget } from '#/web/runtime/runtime-projection-scope.ts'
import type { WorkspacePaneTabsRecoveryActions } from '#/web/runtime/workspace-pane-tabs-recovery.ts'

type WorkspaceRuntimeMembershipRecovery =
  { kind: 'superseded' } | { kind: 'settled'; targets: RuntimeProjectionTarget[] }

export interface WorkspaceRuntimeReconnectRecoveryDependencies {
  scopeRegistry: RuntimeProjectionScopeRegistry
  reconcileMemberships: () => Promise<WorkspaceRuntimeMembershipRecovery>
  currentWorkspaceRuntimeId: (workspaceId: WorkspaceId) => string | null
  terminalRecovery: TerminalProjectionRecoveryActions
  workspaceTabsRecovery: WorkspacePaneTabsRecoveryActions
  beginRecovery: () => (error: unknown) => void
  logFailure: (error: unknown) => void
}

export class WorkspaceRuntimeReconnectRecovery {
  private readonly dependencies: WorkspaceRuntimeReconnectRecoveryDependencies
  private generation = 0

  constructor(dependencies: WorkspaceRuntimeReconnectRecoveryDependencies) {
    this.dependencies = dependencies
  }

  request(): void {
    const generation = ++this.generation
    const failRecovery = this.dependencies.beginRecovery()
    void this.run(generation, failRecovery)
  }

  invalidate(): void {
    this.generation += 1
  }

  private async run(generation: number, failRecovery: (error: unknown) => void): Promise<void> {
    try {
      const recovery = await this.dependencies.reconcileMemberships()
      if (generation !== this.generation) return
      if (recovery.kind === 'superseded') {
        failRecovery(new Error('workspace runtime membership recovery was superseded'))
        return
      }
      const staleTarget = recovery.targets.find(
        (target) => this.dependencies.currentWorkspaceRuntimeId(target.workspaceId) !== target.workspaceRuntimeId,
      )
      if (staleTarget) {
        failRecovery(new Error(`workspace runtime membership changed during recovery for ${staleTarget.workspaceId}`))
        return
      }
      this.dependencies.scopeRegistry.disposeScopes()
      for (const target of recovery.targets) {
        const scope = this.dependencies.scopeRegistry.scopeFor(target)
        this.dependencies.terminalRecovery.begin(scope)
        this.dependencies.terminalRecovery.request(scope, { kind: 'reconnect' })
        this.dependencies.workspaceTabsRecovery.request(scope)
      }
    } catch (error) {
      if (generation === this.generation) {
        failRecovery(error)
        this.dependencies.logFailure(error)
      }
    }
  }
}
