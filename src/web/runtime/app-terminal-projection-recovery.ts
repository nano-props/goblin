import type { TerminalSessionsSnapshot } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { TerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
import type { RuntimeProjectionScope, RuntimeProjectionTarget } from '#/web/runtime/runtime-projection-scope.ts'
import { TerminalProjectionRecoveryCoordinator } from '#/web/runtime/terminal-projection-recovery.ts'

interface TerminalProjectionHydrationEntry {
  workspaceRuntimeId: string
  phase: 'pending' | 'ready' | 'failed'
}

export interface AppTerminalProjectionRecoveryDependencies {
  projection: Pick<
    TerminalSessionProjection,
    'terminalSessionsCatalogCoverageRevision' | 'reconcileServerSessionsSnapshot' | 'resynchronizeConnectedViews'
  >
  readClientId: () => string
  recoverSessions: (target: RuntimeProjectionTarget) => Promise<TerminalSessionsSnapshot>
  hydrationEntry: (workspaceId: WorkspaceId) => TerminalProjectionHydrationEntry | undefined
  beginHydration: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markReady: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => void
  markFailed: (workspaceId: WorkspaceId, workspaceRuntimeId: string, errorMessage: string) => void
  isFocusRefreshDue: (workspaceId: WorkspaceId, workspaceRuntimeId: string) => boolean
  logFailure: (error: unknown) => void
}

export type TerminalProjectionRecoveryRequirement =
  | { kind: 'minimum-revision'; revision: number }
  | { kind: 'reconnect' }

export class AppTerminalProjectionRecovery {
  private readonly dependencies: AppTerminalProjectionRecoveryDependencies
  private readonly coordinator = new TerminalProjectionRecoveryCoordinator()

  constructor(dependencies: AppTerminalProjectionRecoveryDependencies) {
    this.dependencies = dependencies
  }

  begin(scope: RuntimeProjectionScope): void {
    scope.commit(() => {
      this.dependencies.beginHydration(scope.target.workspaceId, scope.target.workspaceRuntimeId)
    })
  }

  isFocusRefreshDue(target: RuntimeProjectionTarget): boolean {
    return this.dependencies.isFocusRefreshDue(target.workspaceId, target.workspaceRuntimeId)
  }

  request(scope: RuntimeProjectionScope, requirement: TerminalProjectionRecoveryRequirement): void {
    const clientId = this.dependencies.readClientId()
    const reconnect = requirement.kind === 'reconnect'
    this.coordinator.request({
      scope,
      minimumRevision: reconnect ? 0 : requirement.revision,
      freshness: reconnect ? 'after-current' : 'join-current',
      recover: async () => await this.dependencies.recoverSessions(scope.target),
      accept: (catalog) => {
        if (!scope.isActive()) return { kind: 'inactive' }
        const localRevision = this.dependencies.projection.terminalSessionsCatalogCoverageRevision(scope.target)
        if (localRevision !== null && localRevision > catalog.revision) {
          return { kind: 'superseded', localRevision }
        }
        const reconciled = this.dependencies.projection.reconcileServerSessionsSnapshot(scope.target, catalog, clientId)
        if (reconciled) return { kind: 'accepted' }
        if (!scope.isActive()) return { kind: 'inactive' }
        const currentRevision = this.dependencies.projection.terminalSessionsCatalogCoverageRevision(scope.target)
        if (currentRevision !== null && currentRevision > catalog.revision) {
          return { kind: 'superseded', localRevision: currentRevision }
        }
        return { kind: 'membership-rejected' }
      },
      complete: () => {
        this.dependencies.markReady(scope.target.workspaceId, scope.target.workspaceRuntimeId)
      },
      afterAccept: reconnect
        ? () =>
            this.dependencies.projection.resynchronizeConnectedViews(
              scope.target.workspaceId,
              scope.target.workspaceRuntimeId,
            )
        : undefined,
      reject: (error) => {
        this.dependencies.logFailure(error)
        const hydration = this.dependencies.hydrationEntry(scope.target.workspaceId)
        if (hydration?.workspaceRuntimeId !== scope.target.workspaceRuntimeId || hydration.phase !== 'pending') return
        this.dependencies.markFailed(
          scope.target.workspaceId,
          scope.target.workspaceRuntimeId,
          projectionHydrationFailureMessage(error),
        )
      },
    })
  }
}

function projectionHydrationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'error.unknown'
}
