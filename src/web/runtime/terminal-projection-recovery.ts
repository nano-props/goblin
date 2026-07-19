import type { TerminalSessionsSnapshot } from '#/shared/terminal-types.ts'
import type { RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'

export type TerminalProjectionRecoveryAcceptance =
  | { kind: 'accepted' }
  | { kind: 'superseded'; localRevision: number }
  | { kind: 'inactive' }
  | { kind: 'membership-rejected' }

interface TerminalProjectionRecoveryRequest {
  scope: RuntimeProjectionScope
  minimumRevision: number
  refresh?: boolean
  recover: () => Promise<TerminalSessionsSnapshot>
  accept: (snapshot: TerminalSessionsSnapshot) => TerminalProjectionRecoveryAcceptance
  complete: () => void
  afterAccept?: () => void
  reject: (error: unknown) => void
}

interface PendingTerminalProjectionRecovery {
  workspaceRuntimeId: string
  minimumRevision: number
  running: boolean
  refreshAfterCurrent: boolean
  latestRequest: TerminalProjectionRecoveryRequest
}

interface TerminalProjectionFreshObligation {
  workspaceRuntimeId: string
  afterAccept: () => void
}

/** Coalesces recovery pressure without aborting an authoritative snapshot read already in flight. */
export class TerminalProjectionRecoveryCoordinator {
  private readonly pendingByWorkspaceId = new Map<string, PendingTerminalProjectionRecovery>()
  private readonly freshObligationByWorkspaceId = new Map<string, TerminalProjectionFreshObligation>()

  request(input: TerminalProjectionRecoveryRequest): void {
    if (!input.scope.isActive()) return
    const { workspaceId, workspaceRuntimeId } = input.scope.target
    const currentObligation = this.freshObligationByWorkspaceId.get(workspaceId)
    if (currentObligation?.workspaceRuntimeId !== workspaceRuntimeId) this.freshObligationByWorkspaceId.delete(workspaceId)
    if (input.afterAccept && !this.freshObligationByWorkspaceId.has(workspaceId)) {
      this.freshObligationByWorkspaceId.set(workspaceId, { workspaceRuntimeId, afterAccept: input.afterAccept })
    }
    let pending = this.pendingByWorkspaceId.get(workspaceId)
    if (pending?.workspaceRuntimeId !== workspaceRuntimeId) {
      pending = {
        workspaceRuntimeId,
        minimumRevision: input.minimumRevision,
        running: false,
        refreshAfterCurrent: false,
        latestRequest: input,
      }
      this.pendingByWorkspaceId.set(workspaceId, pending)
    } else {
      pending.minimumRevision = Math.max(pending.minimumRevision, input.minimumRevision)
      pending.latestRequest = input
    }
    if (pending.running) {
      if (input.refresh) pending.refreshAfterCurrent = true
      return
    }
    pending.running = true
    void this.run(input, pending)
  }

  private async run(
    input: TerminalProjectionRecoveryRequest,
    pending: PendingTerminalProjectionRecovery,
  ): Promise<void> {
    try {
      let staleAttempts = 0
      let supersededAttempts = 0
      for (;;) {
        const request = pending.latestRequest
        let snapshot: TerminalSessionsSnapshot
        try {
          snapshot = await request.recover()
        } catch (error) {
          if (!this.isCurrent(pending.latestRequest.scope, pending)) return
          if (pending.refreshAfterCurrent) {
            pending.refreshAfterCurrent = false
            staleAttempts = 0
            continue
          }
          pending.latestRequest.reject(error)
          return
        }
        if (!this.isCurrent(pending.latestRequest.scope, pending)) return
        if (snapshot.revision < pending.minimumRevision) {
          staleAttempts += 1
          if (staleAttempts >= 2) {
            pending.latestRequest.reject(
              new Error(
                `Terminal sessions recovery did not reach required revision ${pending.minimumRevision}; received ${snapshot.revision}`,
              ),
            )
            return
          }
          // The retry required by the newer revision is itself the fresh read
          // requested while this snapshot was in flight.
          pending.refreshAfterCurrent = false
          continue
        }
        const acceptedRequest = pending.latestRequest
        const acceptance = acceptedRequest.accept(snapshot)
        if (acceptance.kind === 'inactive') return
        if (acceptance.kind === 'membership-rejected') {
          if (!this.isCurrent(acceptedRequest.scope, pending)) return
          acceptedRequest.reject(new Error('Terminal sessions snapshot rejected by the active runtime membership'))
          return
        }
        if (acceptance.kind === 'superseded') {
          supersededAttempts += 1
          if (supersededAttempts >= 2) {
            acceptedRequest.reject(
              new Error(
                `Terminal sessions recovery was repeatedly superseded at local revision ${acceptance.localRevision}`,
              ),
            )
            return
          }
          pending.minimumRevision = Math.max(pending.minimumRevision, acceptance.localRevision)
          pending.refreshAfterCurrent = false
          staleAttempts = 0
          continue
        }
        if (!pending.refreshAfterCurrent) {
          acceptedRequest.complete()
          const obligation = this.freshObligationByWorkspaceId.get(acceptedRequest.scope.target.workspaceId)
          if (obligation?.workspaceRuntimeId === pending.workspaceRuntimeId) {
            this.freshObligationByWorkspaceId.delete(acceptedRequest.scope.target.workspaceId)
            obligation.afterAccept()
          }
          return
        }
        pending.refreshAfterCurrent = false
        staleAttempts = 0
      }
    } catch (error) {
      const request = pending.latestRequest
      if (this.isCurrent(request.scope, pending)) request.reject(error)
    } finally {
      if (this.pendingByWorkspaceId.get(input.scope.target.workspaceId) === pending) {
        this.pendingByWorkspaceId.delete(input.scope.target.workspaceId)
      }
    }
  }

  private isCurrent(scope: RuntimeProjectionScope, pending: PendingTerminalProjectionRecovery): boolean {
    return (
      scope.isActive() &&
      this.pendingByWorkspaceId.get(scope.target.workspaceId) === pending &&
      pending.workspaceRuntimeId === scope.target.workspaceRuntimeId
    )
  }
}
