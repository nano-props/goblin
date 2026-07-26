import type { TerminalSessionsSnapshot } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { TerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
import type { RuntimeProjectionScope, RuntimeProjectionTarget } from '#/web/runtime/runtime-projection-scope.ts'

const TERMINAL_PROJECTION_REFRESH_LANE = 'terminal-projection-refresh'
const TERMINAL_PROJECTION_RECONNECT_LANE = 'terminal-projection-reconnect'

interface TerminalProjectionHydrationEntry {
  workspaceRuntimeId: string
  phase: 'pending' | 'ready' | 'failed'
}

export interface AppTerminalProjectionRecoveryDependencies {
  projection: Pick<
    TerminalSessionProjection,
    'reconcileServerSessionsSnapshot' | 'resynchronizeConnectedViews' | 'terminalSessionsCatalogCoverageRevision'
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
  { kind: 'minimum-revision'; revision: number } | { kind: 'reconnect' }

export class AppTerminalProjectionRecovery {
  private readonly dependencies: AppTerminalProjectionRecoveryDependencies
  private readonly reconnectResynchronizationByScope = new WeakMap<RuntimeProjectionScope, number>()
  private nextReconnectResynchronization = 1

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
    const minimumRevision = reconnect ? 0 : requirement.revision
    const reconnectResynchronization = reconnect
      ? this.requireReconnectResynchronization(scope)
      : (this.reconnectResynchronizationByScope.get(scope) ?? null)
    scope.runLatest(
      reconnect ? TERMINAL_PROJECTION_RECONNECT_LANE : TERMINAL_PROJECTION_REFRESH_LANE,
      async () => await this.dependencies.recoverSessions(scope.target),
      (catalog) => {
        if (catalog.revision < minimumRevision) {
          throw new Error(
            `Terminal sessions recovery did not reach required revision ${minimumRevision}; received ${catalog.revision}`,
          )
        }
        const reconciled = this.dependencies.projection.reconcileServerSessionsSnapshot(scope.target, catalog, clientId)
        if (!reconciled) {
          const currentRevision = this.dependencies.projection.terminalSessionsCatalogCoverageRevision(scope.target)
          if (reconnectResynchronization === null || currentRevision === null || currentRevision <= catalog.revision) {
            throw new Error('Terminal sessions snapshot rejected by the active runtime membership')
          }
        }
        this.consumeReconnectResynchronization(scope, reconnectResynchronization)
        this.dependencies.markReady(scope.target.workspaceId, scope.target.workspaceRuntimeId)
      },
      (error) => {
        this.dependencies.logFailure(error)
        const hydration = this.dependencies.hydrationEntry(scope.target.workspaceId)
        if (hydration?.workspaceRuntimeId !== scope.target.workspaceRuntimeId || hydration.phase !== 'pending') return
        this.dependencies.markFailed(
          scope.target.workspaceId,
          scope.target.workspaceRuntimeId,
          projectionHydrationFailureMessage(error),
        )
      },
    )
  }

  private requireReconnectResynchronization(scope: RuntimeProjectionScope): number {
    const generation = this.nextReconnectResynchronization++
    this.reconnectResynchronizationByScope.set(scope, generation)
    return generation
  }

  private consumeReconnectResynchronization(scope: RuntimeProjectionScope, generation: number | null): void {
    if (generation === null || this.reconnectResynchronizationByScope.get(scope) !== generation) return
    this.dependencies.projection.resynchronizeConnectedViews(scope.target.workspaceId, scope.target.workspaceRuntimeId)
    this.reconnectResynchronizationByScope.delete(scope)
  }
}

function projectionHydrationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'error.unknown'
}
