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
  freshness: 'join-current' | 'after-current'
  recover: () => Promise<TerminalSessionsSnapshot>
  accept: (snapshot: TerminalSessionsSnapshot) => TerminalProjectionRecoveryAcceptance
  complete: () => void
  afterAccept?: () => void
  reject: (error: unknown) => void
}

interface PendingTerminalProjectionRecovery {
  workspaceRuntimeId: string
  minimumRevision: number
  freshReadAfterCurrentRequired: boolean
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
    if (currentObligation?.workspaceRuntimeId !== workspaceRuntimeId)
      this.freshObligationByWorkspaceId.delete(workspaceId)
    if (input.afterAccept && !this.freshObligationByWorkspaceId.has(workspaceId)) {
      this.freshObligationByWorkspaceId.set(workspaceId, { workspaceRuntimeId, afterAccept: input.afterAccept })
    }
    const pending = this.pendingByWorkspaceId.get(workspaceId)
    if (pending?.workspaceRuntimeId === workspaceRuntimeId) {
      pending.minimumRevision = Math.max(pending.minimumRevision, input.minimumRevision)
      pending.latestRequest = input
      if (input.freshness === 'after-current') pending.freshReadAfterCurrentRequired = true
      return
    }
    const admitted: PendingTerminalProjectionRecovery = {
      workspaceRuntimeId,
      minimumRevision: input.minimumRevision,
      freshReadAfterCurrentRequired: false,
      latestRequest: input,
    }
    this.pendingByWorkspaceId.set(workspaceId, admitted)
    void this.run(workspaceId, admitted)
  }

  private async run(workspaceId: string, pending: PendingTerminalProjectionRecovery): Promise<void> {
    try {
      let retriedStaleRevision: number | null = null
      let retriedSupersededRevision: number | null = null
      for (;;) {
        const request = pending.latestRequest
        const minimumRevisionAtReadStart = pending.minimumRevision
        let snapshot: TerminalSessionsSnapshot
        try {
          snapshot = await request.recover()
        } catch (error) {
          if (!this.isCurrent(pending.latestRequest.scope, pending)) return
          if (pending.freshReadAfterCurrentRequired) {
            pending.freshReadAfterCurrentRequired = false
            retriedStaleRevision = null
            retriedSupersededRevision = null
            continue
          }
          if (pending.minimumRevision > minimumRevisionAtReadStart) continue
          pending.latestRequest.reject(error)
          return
        }
        if (!this.isCurrent(pending.latestRequest.scope, pending)) return
        // A reconnect request that arrived while this read was running needs a
        // snapshot whose read began after that reconnect. The current snapshot
        // is valid historical data, but it cannot satisfy that freshness
        // boundary and must not be published as an intermediate projection.
        if (pending.freshReadAfterCurrentRequired) {
          pending.freshReadAfterCurrentRequired = false
          retriedStaleRevision = null
          retriedSupersededRevision = null
          continue
        }
        if (snapshot.revision < pending.minimumRevision) {
          if (retriedStaleRevision === pending.minimumRevision) {
            pending.latestRequest.reject(
              new Error(
                `Terminal sessions recovery did not reach required revision ${pending.minimumRevision}; received ${snapshot.revision}`,
              ),
            )
            return
          }
          retriedStaleRevision = pending.minimumRevision
          // The retry required by the newer revision is itself the fresh read
          // requested while this snapshot was in flight.
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
          if (retriedSupersededRevision === acceptance.localRevision) {
            acceptedRequest.reject(
              new Error(
                `Terminal sessions recovery was repeatedly superseded at local revision ${acceptance.localRevision}`,
              ),
            )
            return
          }
          retriedSupersededRevision = acceptance.localRevision
          pending.minimumRevision = Math.max(pending.minimumRevision, acceptance.localRevision)
          retriedStaleRevision = null
          continue
        }
        const obligation = this.freshObligationByWorkspaceId.get(acceptedRequest.scope.target.workspaceId)
        if (obligation?.workspaceRuntimeId === pending.workspaceRuntimeId) {
          obligation.afterAccept()
          this.freshObligationByWorkspaceId.delete(acceptedRequest.scope.target.workspaceId)
        }
        acceptedRequest.complete()
        return
      }
    } catch (error) {
      const request = pending.latestRequest
      if (this.isCurrent(request.scope, pending)) request.reject(error)
    } finally {
      if (this.pendingByWorkspaceId.get(workspaceId) === pending) this.pendingByWorkspaceId.delete(workspaceId)
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
