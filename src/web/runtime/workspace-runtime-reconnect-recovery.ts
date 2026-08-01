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
    void this.run(generation)
  }

  invalidate(): void {
    this.generation += 1
  }

  private async run(generation: number): Promise<void> {
    try {
      const recovery = await this.dependencies.reconcileMemberships()
      // The latest recovered event owns presentation. We deliberately do not
      // join an older generation that may still be waiting on its one-shot local
      // Refresh. Consequently, overlapping recoveries can project an
      // already-current epoch while its probe is still settling. #359 accepts
      // that reload-recoverable edge instead of adding cross-generation state.
      if (generation !== this.generation || recovery.kind === 'superseded') return
      this.dependencies.scopeRegistry.disposeScopes()
      for (const target of recovery.targets) {
        if (this.dependencies.currentWorkspaceRuntimeId(target.workspaceId) !== target.workspaceRuntimeId) continue
        const scope = this.dependencies.scopeRegistry.scopeFor(target)
        this.dependencies.terminalRecovery.begin(scope)
        this.dependencies.terminalRecovery.request(scope, { kind: 'reconnect' })
        this.dependencies.workspaceTabsRecovery.request(scope)
      }
    } catch (error) {
      if (generation === this.generation) this.dependencies.logFailure(error)
    }
  }
}
