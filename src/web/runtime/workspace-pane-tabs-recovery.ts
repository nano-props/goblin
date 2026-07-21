import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsChangedRealtimeMessage,
} from '#/shared/workspace-pane-tabs.ts'
import type { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'

const WORKSPACE_TABS_REFRESH_LANE = 'workspace-tabs-refresh'

export interface WorkspacePaneTabsRecoveryDependencies {
  list: (target: RuntimeProjectionScope['target']) => Promise<WorkspacePaneTabsSnapshot>
  commit: (target: RuntimeProjectionScope['target'], snapshot: WorkspacePaneTabsSnapshot) => void
  currentRevision: (target: RuntimeProjectionScope['target']) => number | null
  logFailure: (target: RuntimeProjectionScope['target'], error: unknown) => void
}

export class WorkspacePaneTabsRecovery {
  private readonly dependencies: WorkspacePaneTabsRecoveryDependencies

  constructor(dependencies: WorkspacePaneTabsRecoveryDependencies) {
    this.dependencies = dependencies
  }

  request(scope: RuntimeProjectionScope): void {
    scope.runLatest(
      WORKSPACE_TABS_REFRESH_LANE,
      async () => await this.dependencies.list(scope.target),
      (snapshot) => this.dependencies.commit(scope.target, snapshot),
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
    this.request(scope)
  }
}
