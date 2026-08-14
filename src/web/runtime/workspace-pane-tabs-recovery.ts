import type { WorkspacePaneTabsChangedRealtimeMessage } from '#/shared/workspace-pane-tabs.ts'
import type { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'

const WORKSPACE_TABS_REFRESH_LANE = 'workspace-tabs-refresh'

export interface WorkspacePaneTabsRecoveryDependencies {
  refresh: (
    target: RuntimeProjectionScope['target'],
    requirement: WorkspacePaneTabsRecoveryRequirement,
  ) => Promise<void>
  currentRevision: (target: RuntimeProjectionScope['target']) => number | null
  logFailure: (target: RuntimeProjectionScope['target'], error: unknown) => void
}

export interface WorkspacePaneTabsRecoveryActions {
  request(scope: RuntimeProjectionScope, requirement: WorkspacePaneTabsRecoveryRequirement): void
}

export type WorkspacePaneTabsRecoveryRequirement =
  | { kind: 'latest' }
  | { kind: 'minimum-revision'; revision: number }

export class WorkspacePaneTabsRecovery implements WorkspacePaneTabsRecoveryActions {
  private readonly dependencies: WorkspacePaneTabsRecoveryDependencies

  constructor(dependencies: WorkspacePaneTabsRecoveryDependencies) {
    this.dependencies = dependencies
  }

  request(scope: RuntimeProjectionScope, requirement: WorkspacePaneTabsRecoveryRequirement): void {
    scope.runLatest(
      WORKSPACE_TABS_REFRESH_LANE,
      async () => await this.dependencies.refresh(scope.target, requirement),
      () => {},
      (error) => this.dependencies.logFailure(scope.target, error),
    )
  }

  handleChanged(scope: RuntimeProjectionScope, message: WorkspacePaneTabsChangedRealtimeMessage): void {
    if (
      message.change === 'revision' &&
      message.workspaceRuntimeId === scope.target.workspaceRuntimeId &&
      (this.dependencies.currentRevision(scope.target) ?? -1) >= message.revision
    ) {
      return
    }
    const requirement: WorkspacePaneTabsRecoveryRequirement =
      message.change === 'revision' && message.workspaceRuntimeId === scope.target.workspaceRuntimeId
        ? { kind: 'minimum-revision', revision: message.revision }
        : { kind: 'latest' }
    this.request(scope, requirement)
  }
}
