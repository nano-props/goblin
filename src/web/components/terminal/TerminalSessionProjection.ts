import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { createTerminalBellState } from '#/web/components/terminal/terminal-bell-state.ts'
import { createTerminalOutputActivityState } from '#/web/components/terminal/terminal-output-activity-state.ts'
import {
  formatTerminalFilesystemTargetKey,
  parseTerminalFilesystemTargetKey,
} from '#/shared/terminal-filesystem-target-key.ts'
import { terminalClient } from '#/web/terminal.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import type {
  TerminalBellRealtimeEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalProjectionEffect,
  TerminalSessionSummary as ServerTerminalSessionSummary,
  TerminalSessionsSnapshot,
  TerminalTitleEvent,
  WorkspaceRuntimeScope,
} from '#/shared/terminal-types.ts'
import {
  projectCreateResultForClient,
  projectServerTerminalSession,
} from '#/web/components/terminal/terminal-session-projection.ts'
import { userTerminalInput, type TerminalUserInputSource } from '#/web/components/terminal/terminal-input.ts'
import {
  captureTerminalHostGeometry,
  resolveTerminalStartupGeometryHint,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import {
  TerminalSessionLifecycleQueues,
  type TerminalCreateQueueEntry,
} from '#/web/components/terminal/terminal-session-lifecycle-queues.ts'
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from '#/web/components/terminal/terminal-geometry.ts'
import { resolveAdjacentTerminalSelectionAfterRemoval } from '#/web/components/terminal/terminal-session-eviction.ts'
import { syncTerminalRuntimeSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'
import { resolveSelectedTerminalSessionId } from '#/web/components/terminal/terminal-session-selection.ts'
import { buildTerminalFilesystemTargetSnapshot } from '#/web/components/terminal/terminal-session-filesystem-target-snapshot.ts'
import type {
  TerminalDescriptor,
  TerminalCreateOptions,
  TerminalIdentityRealtimeEvent,
  TerminalLifecycleRealtimeEvent,
  TerminalRuntimeMembershipIndex,
  TerminalFilesystemTargetSnapshot,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import {
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { terminalCreateDedupeKey } from '#/web/components/terminal/terminal-create-dedupe.ts'
import type {
  TerminalWorkspacePaneRuntimeCloseEffect,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeTabPlacement,
} from '#/shared/workspace-pane-runtime.ts'
import { workspacePaneRuntimeClient } from '#/web/workspace-pane/workspace-pane-runtime-client.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import { refreshWorkspacePaneTabsQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { writeCanonicalWorkspacePaneTabsSnapshot } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { FutureExitLedger } from '#/web/components/terminal/future-exit-ledger.ts'
import { createTerminalWriteFailureReporter } from '#/web/components/terminal/terminal-write-failure-feedback.ts'
import { terminalDescriptorFilesystemTargetKey } from '#/web/components/terminal/terminal-descriptor.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  canonicalTitle: null,
}
const MAX_PENDING_SERVER_BELLS = 99

interface TerminalCreateQueueRequest {
  createOptions: TerminalCreateOptions
  dedupeKey: string | null
  placement: WorkspacePaneRuntimeTabPlacement
  geometry: { cols: number; rows: number }
}

type TerminalCreateQueueResult = Omit<TerminalCreateAdmissionResult, 'requestRole'>

interface ResolvedTerminalCreateOptions {
  startupShellCommand?: string
}

/**
 * Client-level owner of the local terminal view projection.
 *
 * The server remains authoritative for session existence and lifecycle. This
 * class materializes server results, owns client-only selection/render state,
 * and coordinates pending presentation intents; it must not infer server
 * liveness from its local session map.
 *
 * **Lifetime**: client-level singleton — one instance per client
 * process, created on first access via `getTerminalSessionProjection(...)`,
 * lives until the process tears down. The class is intentionally
 * Provider-independent: `TerminalSessionProvider` is just a wiring
 * adapter that forwards client events into the singleton and exposes
 * its API via React context. A dev-mode React StrictMode re-mount of
 * the Provider must NOT recreate the projection — see
 * `terminal-roadmap.md` P1.7.
 *
 * **Why singleton**: the terminal feature owns cross-cutting state
 * (per-filesystem-target session lists, bell controller, startup geometry hints,
 * selector snapshot caches, pending create/close queues) that has no
 * natural React tree boundary. The previous Provider-owned lifetime
 * required a `pendingProjectionDestroyRef + setTimeout(0)` debounce to
 * survive StrictMode; the singleton removes that dance entirely.
 */
interface TerminalRuntimeBindingIdentity {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  executionRootId: WorkspaceId
  terminalSessionId: string
  terminalRuntimeSessionId: string | null
  terminalRuntimeGeneration: number | null
}

interface TerminalCloseOperation {
  binding: TerminalRuntimeBindingIdentity
  promise: Promise<boolean>
}

function terminalRuntimeBindingKey(binding: TerminalRuntimeBindingIdentity): string {
  return JSON.stringify([
    binding.workspaceId,
    binding.workspaceRuntimeId,
    binding.executionRootId,
    binding.terminalSessionId,
    binding.terminalRuntimeSessionId,
    binding.terminalRuntimeGeneration,
  ])
}

function terminalRealtimeEventBindingKey(event: {
  terminalSessionId: string
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}): string {
  return JSON.stringify([event.terminalSessionId, event.terminalRuntimeSessionId, event.terminalRuntimeGeneration])
}

function terminalRuntimeMembershipKey(workspaceId: WorkspaceId, workspaceRuntimeId: string): string {
  return JSON.stringify([workspaceId, workspaceRuntimeId])
}

function retiredTerminalRuntimeMembershipKeys(
  previous: TerminalRuntimeMembershipIndex,
  next: TerminalRuntimeMembershipIndex,
): string[] {
  return Array.from(previous).flatMap(([workspaceId, membership]) =>
    next.get(workspaceId)?.workspaceRuntimeId === membership.workspaceRuntimeId
      ? []
      : [terminalRuntimeMembershipKey(workspaceId, membership.workspaceRuntimeId)],
  )
}

export class TerminalSessionProjection {
  private readonly writeFailureReporter = createTerminalWriteFailureReporter()
  private readonly onSelectedFilesystemTargetChange: (
    terminalFilesystemTargetKey: string,
    terminalSessionId: string | null,
  ) => void
  private runtimeMembershipIndex: TerminalRuntimeMembershipIndex = new Map()
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly terminalSessionIdByTerminalRuntimeSessionId = new Map<string, Map<number, string>>()
  private readonly terminalRuntimeBindingByTerminalSessionId = new Map<
    string,
    { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }
  >()
  private readonly terminalSessionsCatalogCoverageByWorkspaceId = new Map<
    WorkspaceId,
    { workspaceRuntimeId: string; revision: number }
  >()
  // Client preference only: server owns session existence/control, while
  // each client chooses which terminal to present for a filesystem target.
  private readonly selectedTerminalSessionIdByTerminalFilesystemTarget = new Map<string, string>()
  private readonly preferredSelectedTerminalSessionIdByTerminalFilesystemTarget = new Map<string, string>()
  private readonly hostByFilesystemTarget = new Map<string, HTMLElement>()
  private readonly startupGeometryHintByFilesystemTarget = new Map<string, { cols: number; rows: number }>()
  // Owns pending create promises; server-owned composed commands own close.
  private readonly lifecycleQueues = new TerminalSessionLifecycleQueues<
    TerminalSessionBase,
    TerminalCreateQueueRequest,
    TerminalCreateQueueResult
  >()
  private readonly terminalSessionIdPromiseByCreatePromise = new WeakMap<
    Promise<TerminalCreateQueueResult>,
    Promise<string>
  >()
  // User-initiated close remains visible until server cleanup succeeds. The
  // promise map is the lifecycle owner for dedupe and for ignoring server
  // echoes that arrive before the close command settles.
  private readonly closeOperationByRuntimeBindingKey = new Map<string, TerminalCloseOperation>()
  // Selector publication caches only. They memoize lightweight UI snapshots
  // for React subscribers and do not contain terminal render buffers.
  private readonly snapshotCache = new Map<string, TerminalSnapshot>()
  private readonly filesystemTargetSnapshotCache = new Map<string, TerminalFilesystemTargetSnapshot>()
  private readonly filesystemTargetListeners = new Map<string, Set<() => void>>()
  private readonly workspaceBellCountListeners = new Map<WorkspaceId, Set<() => void>>()
  // Selector publication cache only. The unread bell source of truth
  // stays in `bellState`; this stores the last count delivered to
  // workspace-level subscribers so unrelated filesystem-target events do not
  // wake the workspace picker.
  private readonly lastPublishedWorkspaceBellCount = new Map<WorkspaceId, number>()
  private readonly snapshotListeners = new Map<string, Set<() => void>>()
  private readonly terminalSessionIdsByTerminalFilesystemTarget = new Map<string, string[]>()
  private readonly pendingServerBellByRuntimeBindingKey = new Map<string, TerminalBellRealtimeEvent>()
  private readonly futureExitOrphans = new FutureExitLedger()
  private readonly bellState = createTerminalBellState(
    (terminalSessionId) => {
      if (terminalSessionId) {
        const descriptor = this.sessions.get(terminalSessionId)?.descriptor
        const terminalFilesystemTargetKey = descriptor ? terminalDescriptorFilesystemTargetKey(descriptor) : null
        if (terminalFilesystemTargetKey) this.notifyFilesystemTarget(terminalFilesystemTargetKey)
        return
      }
      this.notifyAllFilesystemTargets()
      this.notifyAllWorkspaceBellCounts()
    },
    (count) => terminalClient.setBadge(count),
  )
  private readonly outputActivityState = createTerminalOutputActivityState((terminalFilesystemTargetKey) =>
    this.notifyFilesystemTarget(terminalFilesystemTargetKey),
  )

  constructor(
    onSelectedFilesystemTargetChange: (
      terminalFilesystemTargetKey: string,
      terminalSessionId: string | null,
    ) => void = () => {},
  ) {
    this.onSelectedFilesystemTargetChange = onSelectedFilesystemTargetChange
  }

  setRuntimeMembershipIndex(runtimeMembershipIndex: TerminalRuntimeMembershipIndex): void {
    for (const retiredScopeKey of retiredTerminalRuntimeMembershipKeys(
      this.runtimeMembershipIndex,
      runtimeMembershipIndex,
    )) {
      this.futureExitOrphans.retireSnapshotScope(retiredScopeKey)
    }
    this.runtimeMembershipIndex = runtimeMembershipIndex
    this.pruneSessionsMissingFromRuntimeMembership()
  }

  /**
   * Test-only / explicit-teardown path.
   *
   * Production code does NOT call this. The projection is a client-
   * level singleton and is meant to live for the client's entire
   * lifetime. The Provider never invokes `destroy()` on unmount; the
   * `pendingProjectionDestroyRef + setTimeout` debounce that used to
   * gate a Provider-unmount destroy has been removed.
   *
   * Tests use `destroy()` on a per-test local instance to drain
   * pending promises and clear listener maps before the test seam
   * (`setTerminalSessionProjectionForTests`) resets the singleton projection.
   *
   * Real production callers should only reach for this in narrowly
   * justified scenarios: a forced reset action in a dev menu, or a
   * `before-quit` handler that wants to reject in-flight creates/
   * closes. If you're tempted to call this from a Provider effect,
   * stop — the singleton already outlives that effect.
   */
  destroy(): void {
    setTerminalFocused(false)
    this.lifecycleQueues.rejectAll(new Error('terminal session projection destroyed'))
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.terminalSessionIdByTerminalRuntimeSessionId.clear()
    this.terminalRuntimeBindingByTerminalSessionId.clear()
    this.terminalSessionsCatalogCoverageByWorkspaceId.clear()
    this.selectedTerminalSessionIdByTerminalFilesystemTarget.clear()
    this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.clear()
    this.hostByFilesystemTarget.clear()
    this.startupGeometryHintByFilesystemTarget.clear()
    this.closeOperationByRuntimeBindingKey.clear()
    this.snapshotCache.clear()
    this.filesystemTargetSnapshotCache.clear()
    this.filesystemTargetListeners.clear()
    this.workspaceBellCountListeners.clear()
    this.lastPublishedWorkspaceBellCount.clear()
    this.snapshotListeners.clear()
    this.terminalSessionIdsByTerminalFilesystemTarget.clear()
    this.pendingServerBellByRuntimeBindingKey.clear()
    this.futureExitOrphans.clear()
    this.bellState.reset()
    this.outputActivityState.reset()
    if (projectionInstance === this) projectionInstance = null
  }

  // Single routing entry point for every realtime event keyed by a
  // session. `terminalSessionId` (the durable tab identity) is tried
  // first to locate the session because it needs no client-local state
  // to resolve. `terminalRuntimeSessionId` (the server runtime lookup id) is a
  // secondary fallback through a client-local index that is only
  // populated once a session has been attached/reconciled locally — a
  // background tab that has never been selected may not have an index
  // entry yet. A realtime event that only carries `terminalRuntimeSessionId` cannot
  // be routed reliably for such a tab; that gap is exactly what caused
  // a background tab's title updates to be silently dropped, so every
  // realtime event type must carry `terminalSessionId` (see the
  // naming-boundary note on the event types in
  // `#/shared/terminal-types.ts`) and every dispatcher must resolve
  // through this helper rather than reimplementing the fallback.
  private resolveSessionForRealtimeEvent(event: {
    terminalSessionId: string
    terminalRuntimeSessionId: string
    terminalRuntimeGeneration: number
  }): TerminalSession | null {
    return (
      this.sessions.get(event.terminalSessionId) ??
      this.sessions.get(
        this.terminalSessionIdByTerminalRuntimeSessionId
          .get(event.terminalRuntimeSessionId)
          ?.get(event.terminalRuntimeGeneration) ?? '',
      ) ??
      null
    )
  }

  private classifyRealtimeEvent(event: {
    terminalSessionId: string
    terminalRuntimeSessionId: string
    terminalRuntimeGeneration: number
  }): { session: TerminalSession; classification: 'active' | 'retiring' | 'future' | 'foreign' } | null {
    const session = this.resolveSessionForRealtimeEvent(event)
    if (!session) return null
    return { session, classification: session.classifyRuntimeBinding(event) }
  }

  handleOutput(event: TerminalOutputEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (!classified || classified.classification !== 'active') return
    const { session } = classified
    session.handleOutput(event)
    if (event.data.length > 0)
      this.outputActivityState.markOutput(
        session.descriptor.terminalSessionId,
        terminalDescriptorFilesystemTargetKey(session.descriptor),
      )
  }

  handleServerBell(event: TerminalBellRealtimeEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (!classified || classified.classification === 'future') {
      const bindingKey = terminalRealtimeEventBindingKey(event)
      this.trimPendingServerBellsForInsert(bindingKey)
      this.pendingServerBellByRuntimeBindingKey.set(bindingKey, event)
      return
    }
    if (classified.classification === 'foreign' || classified.classification === 'retiring') return
    this.applyServerBell(classified.session, event)
  }

  private trimPendingServerBellsForInsert(bindingKey: string): void {
    if (this.pendingServerBellByRuntimeBindingKey.has(bindingKey)) return
    while (this.pendingServerBellByRuntimeBindingKey.size >= MAX_PENDING_SERVER_BELLS) {
      const oldestBindingKey = this.pendingServerBellByRuntimeBindingKey.keys().next().value
      if (!oldestBindingKey) return
      this.pendingServerBellByRuntimeBindingKey.delete(oldestBindingKey)
    }
  }

  private applyServerBell(session: TerminalSession, event: TerminalBellRealtimeEvent): void {
    this.pendingServerBellByRuntimeBindingKey.delete(terminalRealtimeEventBindingKey(event))
    this.bellState.handleBell(session.descriptor, {
      processName: event.processName,
      canonicalTitle: event.canonicalTitle,
      visible: session.isVisible(),
    })
  }

  handleServerTitle(event: TerminalTitleEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (classified?.classification === 'active') classified.session.handleServerTitle(event.canonicalTitle)
  }

  handleExit(event: TerminalExitEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (!classified) {
      this.futureExitOrphans.record(event)
      this.pendingServerBellByRuntimeBindingKey.delete(terminalRealtimeEventBindingKey(event))
      return
    }
    if (
      terminalSessionCoordinates(classified.session.descriptor).workspaceId !== event.workspaceId ||
      terminalSessionCoordinates(classified.session.descriptor).workspaceRuntimeId !== event.workspaceRuntimeId
    ) {
      return
    }
    if (classified.classification === 'future' || classified.classification === 'foreign') {
      this.futureExitOrphans.record(event)
      this.pendingServerBellByRuntimeBindingKey.delete(terminalRealtimeEventBindingKey(event))
      return
    }
    if (classified.classification === 'retiring') return
    const { session } = classified
    const terminalSessionId = session.descriptor.terminalSessionId
    const binding = this.runtimeBindingForSession(
      session,
      event.terminalRuntimeSessionId,
      event.terminalRuntimeGeneration,
    )
    this.futureExitOrphans.record(event, 'durable')
    if (session.handleExit(event)) {
      // Local runtime accepted the exit. Gating the discard on the
      // runtime's accept (rather than evicting eagerly on a session
      // match) avoids discarding a live local session during a race
      // where the session has moved to a new terminalRuntimeSessionId (e.g. after
      // a server-side restart) but a stale index entry still maps the
      // old terminalRuntimeSessionId to the same terminalSessionId.
      this.discardLocalSessionAndDismissDetailIfLast(terminalSessionId, session.descriptor, binding, true)
      return
    }
  }

  // Targeted drop on a server-side `session-closed` broadcast. Mirrors
  // `handleExit` but for the close path: the originating window has
  // already disposed the local entry, so the no-op case is the
  // common one. Sibling windows with a stale local entry get
  // consistent state within one network roundtrip instead of waiting
  // for the broader `sessions-changed` list-rescan. We route through
  // `discardLocalSessionAndDismissDetailIfLast` (rather than
  // `closeTerminal`) because the server has already killed the PTY
  // — calling `close` again would no-op the `closeSessionForUser` check
  // on the server and add a useless WS roundtrip.
  handleSessionClosed(event: {
    terminalRuntimeSessionId: string
    terminalRuntimeGeneration: number
    terminalSessionId: string
  }): void {
    const bindingKey = terminalRealtimeEventBindingKey(event)
    const classified = this.classifyRealtimeEvent(event)
    if (!classified || classified.classification === 'foreign' || classified.classification === 'future') {
      this.pendingServerBellByRuntimeBindingKey.delete(bindingKey)
      return
    }
    const { session } = classified
    this.pendingServerBellByRuntimeBindingKey.delete(bindingKey)
    this.discardLocalSessionAndDismissDetailIfLast(
      session.descriptor.terminalSessionId,
      session.descriptor,
      this.runtimeBindingForSession(session, event.terminalRuntimeSessionId, event.terminalRuntimeGeneration),
    )
  }

  handleIdentity(event: TerminalIdentityRealtimeEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (classified?.classification === 'active') classified.session.handleIdentity(event)
  }

  handleLifecycle(event: TerminalLifecycleRealtimeEvent): void {
    const classified = this.classifyRealtimeEvent(event)
    if (classified?.classification === 'active') classified.session.handleLifecycle(event)
  }

  reconcileServerSessions(
    scope: WorkspaceRuntimeScope,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
  ): boolean {
    if (this.runtimeMembershipIndex.get(scope.workspaceId)?.workspaceRuntimeId !== scope.workspaceRuntimeId)
      return false

    const { controllerTerminalSessionIdByFilesystemTarget, touchedFilesystemTargets, tabsChangedFilesystemTargets } =
      this.materializeServerSessions(scope, serverSessions, clientId)

    const authoritativeServerSessions = serverSessions.filter((session) => {
      const coordinates = terminalSessionCoordinates(session)
      return (
        coordinates.workspaceId === scope.workspaceId && coordinates.workspaceRuntimeId === scope.workspaceRuntimeId
      )
    })
    const serverTerminalSessionIds = new Set(authoritativeServerSessions.map((session) => session.terminalSessionId))
    this.evictOrphanedLocalSessions(scope, serverTerminalSessionIds)
    this.futureExitOrphans.confirmAuthoritativeSnapshot(
      terminalRuntimeMembershipKey(scope.workspaceId, scope.workspaceRuntimeId),
      authoritativeServerSessions.map((session) => ({
        terminalSessionId: session.terminalSessionId,
        terminalRuntimeSessionId: session.terminalRuntimeSessionId,
        terminalRuntimeGeneration: session.terminalRuntimeGeneration,
        workspaceId: scope.workspaceId,
        workspaceRuntimeId: scope.workspaceRuntimeId,
      })),
    )

    this.resolveSelectedTerminalSessionIdsForTouchedFilesystemTargets(
      touchedFilesystemTargets,
      controllerTerminalSessionIdByFilesystemTarget,
    )
    for (const terminalFilesystemTargetKey of tabsChangedFilesystemTargets) {
      this.notifyFilesystemTarget(terminalFilesystemTargetKey)
    }
    return true
  }

  reconcileServerSessionsSnapshot(
    scope: WorkspaceRuntimeScope,
    snapshot: TerminalSessionsSnapshot,
    clientId: string,
  ): boolean {
    const current = this.terminalSessionsCatalogCoverageByWorkspaceId.get(scope.workspaceId)
    if (current?.workspaceRuntimeId === scope.workspaceRuntimeId && snapshot.revision < current.revision) return false
    if (!this.reconcileServerSessions(scope, snapshot.sessions, clientId)) return false
    this.terminalSessionsCatalogCoverageByWorkspaceId.set(scope.workspaceId, {
      workspaceRuntimeId: scope.workspaceRuntimeId,
      revision: snapshot.revision,
    })
    return true
  }

  terminalSessionsCatalogCoverageRevision(scope: WorkspaceRuntimeScope): number | null {
    const current = this.terminalSessionsCatalogCoverageByWorkspaceId.get(scope.workspaceId)
    return current?.workspaceRuntimeId === scope.workspaceRuntimeId ? current.revision : null
  }

  applyTerminalSessionsDeltaRevision(scope: WorkspaceRuntimeScope, revision: number): boolean {
    if (this.runtimeMembershipIndex.get(scope.workspaceId)?.workspaceRuntimeId !== scope.workspaceRuntimeId)
      return false
    const current = this.terminalSessionsCatalogCoverageByWorkspaceId.get(scope.workspaceId)
    const coverageRevision = current?.workspaceRuntimeId === scope.workspaceRuntimeId ? current.revision : 0
    if (revision <= coverageRevision) return true
    if (revision !== coverageRevision + 1) return true
    this.terminalSessionsCatalogCoverageByWorkspaceId.set(scope.workspaceId, {
      workspaceRuntimeId: scope.workspaceRuntimeId,
      revision,
    })
    return true
  }

  private applyServerSessionEffect(
    scope: WorkspaceRuntimeScope,
    effect: TerminalProjectionEffect,
    serverSession: ServerTerminalSessionSummary,
    clientId: string,
  ): boolean {
    if (this.runtimeMembershipIndex.get(scope.workspaceId)?.workspaceRuntimeId !== scope.workspaceRuntimeId)
      return false
    const current = this.terminalSessionsCatalogCoverageByWorkspaceId.get(scope.workspaceId)
    const coverageRevision = current?.workspaceRuntimeId === scope.workspaceRuntimeId ? current.revision : 0
    if (effect.kind === 'delta' && effect.revision <= coverageRevision) return false
    const { controllerTerminalSessionIdByFilesystemTarget, touchedFilesystemTargets, tabsChangedFilesystemTargets } =
      this.materializeServerSessions(scope, [serverSession], clientId, {
        mergeIntoExisting: true,
        hydrationSource: 'partial-effect',
      })
    this.resolveSelectedTerminalSessionIdsForTouchedFilesystemTargets(
      touchedFilesystemTargets,
      controllerTerminalSessionIdByFilesystemTarget,
    )
    for (const terminalFilesystemTargetKey of tabsChangedFilesystemTargets)
      this.notifyFilesystemTarget(terminalFilesystemTargetKey)
    if (effect.kind === 'delta' && effect.revision === coverageRevision + 1) {
      this.terminalSessionsCatalogCoverageByWorkspaceId.set(scope.workspaceId, {
        workspaceRuntimeId: scope.workspaceRuntimeId,
        revision: effect.revision,
      })
    }
    return true
  }

  // Phase 1: for each server session, ensure a local TerminalSession
  // exists, hydrate it with the latest server-side metadata, and track
  // which filesystem targets saw any change. Side effects: ensureSession,
  // session.hydrate, terminalSessionIdsByTerminalFilesystemTarget, syncTerminalRuntimeSessionIdIndex.
  private materializeServerSessions(
    scope: WorkspaceRuntimeScope,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
    options: {
      mergeIntoExisting?: boolean
      hydrationSource?: 'snapshot' | 'partial-effect'
    } = {},
  ): {
    controllerTerminalSessionIdByFilesystemTarget: Map<string, string>
    touchedFilesystemTargets: Set<string>
    tabsChangedFilesystemTargets: Set<string>
  } {
    const controllerTerminalSessionIdByFilesystemTarget = new Map<string, string>()
    const touchedFilesystemTargets = new Set<string>()
    const terminalSessionIdsByTouchedFilesystemTarget = new Map<string, string[]>()
    const nextIndexByFilesystemTarget = new Map<string, number>()

    for (const serverSession of serverSessions) {
      const coordinates = terminalSessionCoordinates(serverSession)
      const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(
        coordinates.workspaceId,
        coordinates.executionRootId,
      )
      const existingSessionIds = options.mergeIntoExisting
        ? (this.terminalSessionIdsByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? [])
        : []
      const existingIndex = existingSessionIds.indexOf(serverSession.terminalSessionId)
      const index =
        existingIndex >= 0
          ? existingIndex + 1
          : (nextIndexByFilesystemTarget.get(terminalFilesystemTargetKey) ?? existingSessionIds.length) + 1
      const projected = projectServerTerminalSession({
        workspaceId: scope.workspaceId,
        workspaceRuntimeId: scope.workspaceRuntimeId,
        serverSession,
        clientId,
        index,
      })
      if (!projected) continue
      touchedFilesystemTargets.add(projected.terminalFilesystemTargetKey)
      nextIndexByFilesystemTarget.set(projected.terminalFilesystemTargetKey, index)
      const descriptor = projected.descriptor
      const session = this.ensureSession(descriptor)
      session.hydrate(projected.hydrateInput, options.hydrationSource ?? 'snapshot')
      if (!this.sessions.has(descriptor.terminalSessionId)) continue
      if (projected.controlsTerminal)
        controllerTerminalSessionIdByFilesystemTarget.set(
          projected.terminalFilesystemTargetKey,
          descriptor.terminalSessionId,
        )
      pushUniqueMapList(
        terminalSessionIdsByTouchedFilesystemTarget,
        projected.terminalFilesystemTargetKey,
        descriptor.terminalSessionId,
      )
    }

    const nextSessionIdsByFilesystemTarget = new Map(terminalSessionIdsByTouchedFilesystemTarget)
    if (options.mergeIntoExisting) {
      for (const [terminalFilesystemTargetKey, incomingSessionIds] of terminalSessionIdsByTouchedFilesystemTarget) {
        const existingSessionIds =
          this.terminalSessionIdsByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? []
        nextSessionIdsByFilesystemTarget.set(terminalFilesystemTargetKey, [
          ...existingSessionIds,
          ...incomingSessionIds.filter((sessionId) => !existingSessionIds.includes(sessionId)),
        ])
      }
    }
    const tabsChangedFilesystemTargets = this.replaceTerminalSessionIdListForTouchedFilesystemTargets(
      nextSessionIdsByFilesystemTarget,
    )
    return { controllerTerminalSessionIdByFilesystemTarget, touchedFilesystemTargets, tabsChangedFilesystemTargets }
  }

  // Phase 2: the accepted catalog is the complete membership authority for
  // this workspace runtime. Pending creates live in lifecycle queues, not sessions.
  private evictOrphanedLocalSessions(scope: WorkspaceRuntimeScope, serverTerminalSessionIds: Set<string>): number {
    const orphanedTerminalSessionIds = Array.from(this.sessions.values())
      .filter(
        (session) =>
          terminalSessionCoordinates(session.descriptor).workspaceId === scope.workspaceId &&
          terminalSessionCoordinates(session.descriptor).workspaceRuntimeId === scope.workspaceRuntimeId &&
          !serverTerminalSessionIds.has(session.descriptor.terminalSessionId),
      )
      .map((session) => session.descriptor.terminalSessionId)
    for (const terminalSessionId of orphanedTerminalSessionIds) {
      const session = this.sessions.get(terminalSessionId)
      if (!session) continue
      this.discardLocalSessionAndDismissDetailIfLast(terminalSessionId, session.descriptor)
    }
    return orphanedTerminalSessionIds.length
  }

  // Phase 3: for every filesystem target that saw a server-side change, decide
  // which local terminal should be selected. The selection prefers the
  // controller of the target, then the user's last selection, then
  // the first available terminal.
  private resolveSelectedTerminalSessionIdsForTouchedFilesystemTargets(
    touchedFilesystemTargets: Set<string>,
    controllerTerminalSessionIdByFilesystemTarget: Map<string, string>,
  ): void {
    for (const terminalFilesystemTargetKey of touchedFilesystemTargets) {
      const current = this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null
      const preferred =
        this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null
      const next = resolveSelectedTerminalSessionId({
        terminalFilesystemTargetKey,
        preferredSessionId: preferred,
        currentSessionId: current,
        controllerSessionId: controllerTerminalSessionIdByFilesystemTarget.get(terminalFilesystemTargetKey) ?? null,
        sortedDescriptors: this.visibleSessionsForFilesystemTarget(terminalFilesystemTargetKey).map(
          (session) => session.descriptor,
        ),
        isSelectedTerminalSessionIdValid: (candidateTerminalFilesystemTargetKey, terminalSessionId) =>
          this.isSelectedTerminalSessionIdValid(candidateTerminalFilesystemTargetKey, terminalSessionId),
      })
      this.selectTerminalSessionId(terminalFilesystemTargetKey, next)
    }
  }

  createTerminal = (base: TerminalSessionBase, options: TerminalCreateOptions = {}): Promise<string> => {
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(
      terminalSessionCoordinates(base).workspaceId,
      terminalSessionCoordinates(base).executionRootId,
    )
    const admission = this.enqueueCreateRequest(base, terminalFilesystemTargetKey, {
      createOptions: options,
      dedupeKey: terminalCreateDedupeKey(options),
      placement: {},
      geometry: this.startupGeometryHint(terminalFilesystemTargetKey),
    })
    const existing = this.terminalSessionIdPromiseByCreatePromise.get(admission.promise)
    if (existing) return existing
    const terminalSessionIdPromise = admission.promise.then((result) => result.terminalSessionId)
    this.terminalSessionIdPromiseByCreatePromise.set(admission.promise, terminalSessionIdPromise)
    return terminalSessionIdPromise
  }

  createTerminalWithAdmission = async (
    base: TerminalSessionBase,
    options: TerminalCreateOptions = {},
    placement: WorkspacePaneRuntimeTabPlacement = {},
  ): Promise<TerminalCreateAdmissionResult> => {
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(
      terminalSessionCoordinates(base).workspaceId,
      terminalSessionCoordinates(base).executionRootId,
    )
    const admission = this.enqueueCreateRequest(base, terminalFilesystemTargetKey, {
      createOptions: options,
      dedupeKey: terminalCreateDedupeKey(options),
      placement,
      geometry: this.startupGeometryHint(terminalFilesystemTargetKey),
    })
    const result = await admission.promise
    return {
      ...result,
      requestRole: admission.ownsAdmission ? 'leader' : 'observer',
    }
  }

  registerHost = (terminalFilesystemTargetKey: string, host: HTMLElement): void => {
    this.hostByFilesystemTarget.set(terminalFilesystemTargetKey, host)
    captureTerminalHostGeometry({
      terminalFilesystemTargetKey,
      hostByFilesystemTarget: this.hostByFilesystemTarget,
      startupGeometryHintByFilesystemTarget: this.startupGeometryHintByFilesystemTarget,
    })
  }

  unregisterHost = (terminalFilesystemTargetKey: string, host: HTMLElement): void => {
    if (this.hostByFilesystemTarget.get(terminalFilesystemTargetKey) !== host) return
    this.hostByFilesystemTarget.delete(terminalFilesystemTargetKey)
  }

  private async performCreateTerminal(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
    terminalFilesystemTargetKey: string,
    pending: TerminalCreateQueueEntry<TerminalSessionBase, TerminalCreateQueueRequest, TerminalCreateQueueResult>,
    createOptions: ResolvedTerminalCreateOptions,
  ): Promise<TerminalCreateQueueResult> {
    return await this.performCreateTerminalNow(base, geometry, terminalFilesystemTargetKey, pending, createOptions)
  }

  private async performCreateTerminalNow(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
    terminalFilesystemTargetKey: string,
    pending: TerminalCreateQueueEntry<TerminalSessionBase, TerminalCreateQueueRequest, TerminalCreateQueueResult>,
    createOptions: ResolvedTerminalCreateOptions,
  ): Promise<TerminalCreateQueueResult> {
    this.requireCurrentCreateRequest(terminalFilesystemTargetKey, pending)
    const request = pending.options
    const clientId = readOrCreateWebTerminalClientId()
    const createKind = createOptions.startupShellCommand
      ? 'additional'
      : this.visibleSessionsForFilesystemTarget(terminalFilesystemTargetKey).length === 0
        ? 'primary'
        : 'additional'
    pending.creating = true
    const openResult = await workspacePaneRuntimeClient.open({
      runtimeType: 'terminal',
      request: {
        kind: createKind,
        ...(createOptions.startupShellCommand ? { startupShellCommand: createOptions.startupShellCommand } : {}),
        cols: geometry.cols,
        rows: geometry.rows,
        clientId,
        target: base.target,
      },
      ...request.placement,
    })
    if (!openResult.ok) throw new Error(openResult.message)
    writeCanonicalWorkspacePaneTabsSnapshot(
      terminalSessionCoordinates(base).workspaceId,
      terminalSessionCoordinates(base).workspaceRuntimeId,
      openResult.paneTabsSnapshot,
    )
    const result = openResult.runtime
    if (!result.terminalRuntimeSessionId) throw new Error('error.terminal-create-failed')
    let runtimeProjectionApplied = false
    if (this.lifecycleQueues.getCreate(terminalFilesystemTargetKey) === pending) {
      const projectedCreate = projectCreateResultForClient(base, result)
      if (this.lifecycleQueues.getCreate(terminalFilesystemTargetKey) === pending) {
        runtimeProjectionApplied = this.applyServerSessionEffect(
          {
            workspaceId: terminalSessionCoordinates(base).workspaceId,
            workspaceRuntimeId: terminalSessionCoordinates(base).workspaceRuntimeId,
          },
          result.terminalProjectionEffect,
          projectedCreate.serverSession,
          clientId,
        )
        if (runtimeProjectionApplied) {
          this.setPreferredSelectedTerminalSessionId(terminalFilesystemTargetKey, result.terminalSessionId)
        }
      }
    }
    return {
      terminalSessionId: result.terminalSessionId,
      presentation: result.presentation,
      resourceDisposition: result.action,
      runtimeProjectionApplied,
    }
  }

  private requireCurrentCreateRequest(
    terminalFilesystemTargetKey: string,
    pending: TerminalCreateQueueEntry<TerminalSessionBase, TerminalCreateQueueRequest, TerminalCreateQueueResult>,
  ): void {
    if (this.lifecycleQueues.getCreate(terminalFilesystemTargetKey) !== pending) {
      throw new Error('terminal create request canceled')
    }
  }

  private startupGeometryHint(terminalFilesystemTargetKey: string): { cols: number; rows: number } {
    return (
      resolveTerminalStartupGeometryHint({
        terminalFilesystemTargetKey,
        hostByFilesystemTarget: this.hostByFilesystemTarget,
        startupGeometryHintByFilesystemTarget: this.startupGeometryHintByFilesystemTarget,
        selectedDescriptor: this.selectedDescriptor(terminalFilesystemTargetKey),
        getAttachmentSnapshot: (terminalSessionId) => this.snapshot(terminalSessionId).attachment,
      }) ?? { cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS }
    )
  }

  private enqueueCreateRequest(
    base: TerminalSessionBase,
    terminalFilesystemTargetKey: string,
    request: TerminalCreateQueueRequest,
  ): { promise: Promise<TerminalCreateQueueResult>; ownsAdmission: boolean } {
    const admission = this.lifecycleQueues.enqueueCreate({
      terminalFilesystemTargetKey,
      base,
      options: request,
      isSameRequest: (existing, next) => existing.dedupeKey !== null && existing.dedupeKey === next.dedupeKey,
      flush: (key) => {
        void this.flushCreateRequest(key)
      },
    })
    this.notifyFilesystemTarget(terminalFilesystemTargetKey)
    return admission
  }

  private async flushCreateRequest(terminalFilesystemTargetKey: string): Promise<void> {
    const pending = this.lifecycleQueues.getCreate(terminalFilesystemTargetKey)
    if (!pending || pending.flushing) return
    // Synchronous claim: enqueueCreateRequest, registerHost, and a
    // StrictMode double-invoke can all arrive here while a prior flush
    // is still awaiting. The first one through sets the flag; the rest
    // bail and observe the same pending promise.
    pending.flushing = true
    try {
      pending.resolve(await this.flushCreateRequestNow(terminalFilesystemTargetKey, pending))
    } catch (error) {
      pending.reject(error)
    } finally {
      pending.creating = false
      if (this.lifecycleQueues.deleteCreate(terminalFilesystemTargetKey, pending)) {
        this.notifyFilesystemTarget(terminalFilesystemTargetKey)
        if (this.lifecycleQueues.hasCreate(terminalFilesystemTargetKey)) {
          void this.flushCreateRequest(terminalFilesystemTargetKey)
        }
      }
    }
  }

  private async flushCreateRequestNow(
    terminalFilesystemTargetKey: string,
    pending: TerminalCreateQueueEntry<TerminalSessionBase, TerminalCreateQueueRequest, TerminalCreateQueueResult>,
  ): Promise<TerminalCreateQueueResult> {
    if (this.lifecycleQueues.getCreate(terminalFilesystemTargetKey) !== pending) {
      throw new Error('terminal create request canceled')
    }
    const createOptions = await this.resolveCurrentCreateOptions(terminalFilesystemTargetKey, pending)
    this.requireCurrentCreateRequest(terminalFilesystemTargetKey, pending)
    return await this.performCreateTerminal(
      pending.base,
      pending.options.geometry,
      terminalFilesystemTargetKey,
      pending,
      createOptions,
    )
  }

  private async resolveCurrentCreateOptions(
    terminalFilesystemTargetKey: string,
    pending: TerminalCreateQueueEntry<TerminalSessionBase, TerminalCreateQueueRequest, TerminalCreateQueueResult>,
  ): Promise<ResolvedTerminalCreateOptions> {
    this.requireCurrentCreateRequest(terminalFilesystemTargetKey, pending)
    const request = pending.options
    const createOptions = await resolveTerminalCreateOptionsUntilCreateSettles(request.createOptions, pending.promise)
    this.requireCurrentCreateRequest(terminalFilesystemTargetKey, pending)
    return createOptions
  }

  private selectedDescriptor(terminalFilesystemTargetKey: string): TerminalDescriptor | null {
    const selectedKey = this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey)
    return selectedKey ? (this.sessions.get(selectedKey)?.descriptor ?? null) : null
  }

  setPreferredSelectedTerminalSessionIds(selectedKeysByFilesystemTarget: Record<string, string>): void {
    const nextPreferred = new Map(Object.entries(selectedKeysByFilesystemTarget))
    const filesystemTargets = new Set<string>([
      ...Array.from(this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.keys()),
      ...Array.from(nextPreferred.keys()),
      ...Array.from(this.selectedTerminalSessionIdByTerminalFilesystemTarget.keys()),
    ])
    this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.clear()
    for (const [terminalFilesystemTargetKey, terminalSessionId] of nextPreferred)
      this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.set(
        terminalFilesystemTargetKey,
        terminalSessionId,
      )
    for (const terminalFilesystemTargetKey of filesystemTargets) {
      const preferred =
        this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null
      if (!preferred || !this.isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey, preferred)) continue
      this.selectTerminalSessionId(terminalFilesystemTargetKey, preferred)
    }
  }

  terminalFilesystemTargetSnapshot = (terminalFilesystemTargetKey: string): TerminalFilesystemTargetSnapshot => {
    const cached = this.filesystemTargetSnapshotCache.get(terminalFilesystemTargetKey)
    if (cached) return cached
    const snapshot = buildTerminalFilesystemTargetSnapshot({
      terminalFilesystemTargetKey,
      selectedDescriptor: this.selectedDescriptor(terminalFilesystemTargetKey),
      createPending: this.lifecycleQueues.hasCreate(terminalFilesystemTargetKey),
      sessions: this.visibleSessionsForFilesystemTarget(terminalFilesystemTargetKey),
      selectedTerminalSessionId:
        this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null,
      getCachedSnapshot: (terminalSessionId) => this.snapshotCache.get(terminalSessionId) ?? null,
      cacheSnapshot: (terminalSessionId, nextSnapshot) => this.snapshotCache.set(terminalSessionId, nextSnapshot),
      hasBell: (terminalSessionId) => this.bellState.hasBell(terminalSessionId),
      hasRecentOutput: (terminalSessionId) => this.outputActivityState.hasRecentOutput(terminalSessionId),
    })
    this.filesystemTargetSnapshotCache.set(terminalFilesystemTargetKey, snapshot)
    return snapshot
  }

  subscribeTerminalFilesystemTarget = (terminalFilesystemTargetKey: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.filesystemTargetListeners, terminalFilesystemTargetKey, listener)
  }

  workspaceBellCount = (workspaceId: WorkspaceId): number => {
    let count = 0
    for (const session of this.sessions.values()) {
      const terminalSessionId = session.descriptor.terminalSessionId
      if (
        terminalSessionCoordinates(session.descriptor).workspaceId === workspaceId &&
        this.bellState.hasBell(terminalSessionId)
      )
        count++
    }
    return count
  }

  subscribeWorkspaceBellCount = (workspaceId: WorkspaceId, listener: () => void): (() => void) => {
    if (!this.workspaceBellCountListeners.has(workspaceId))
      this.lastPublishedWorkspaceBellCount.set(workspaceId, this.workspaceBellCount(workspaceId))
    const unsubscribe = this.subscribeToKeyedListeners(this.workspaceBellCountListeners, workspaceId, listener)
    return () => {
      unsubscribe()
      if (!this.workspaceBellCountListeners.has(workspaceId)) this.lastPublishedWorkspaceBellCount.delete(workspaceId)
    }
  }

  selectTerminal = (terminalFilesystemTargetKey: string, terminalSessionId: string): void => {
    const session = this.sessions.get(terminalSessionId)
    if (!session || terminalDescriptorFilesystemTargetKey(session.descriptor) !== terminalFilesystemTargetKey) return
    const wasSelected =
      this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) === terminalSessionId
    const hadBell = this.bellState.hasBell(terminalSessionId)
    if (wasSelected && !hadBell) return
    this.selectTerminalSessionId(terminalFilesystemTargetKey, terminalSessionId, { notify: !hadBell })
    this.bellState.clear(terminalSessionId)
  }

  clearBell = (terminalSessionId: string): boolean => {
    return this.bellState.clear(terminalSessionId)
  }

  scrollToBottom = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.scrollToBottom()
  }

  scrollLines = (terminalSessionId: string, amount: number): void => {
    this.sessions.get(terminalSessionId)?.scrollLines(amount)
  }

  closeTerminalByDescriptor = async (terminalSessionId: string, base: TerminalSessionBase): Promise<boolean> => {
    return await this.closeTerminalRuntimeTab(terminalSessionId, base)
  }

  attach = (descriptor: TerminalDescriptor, host: HTMLElement): void => {
    this.ensureSession(descriptor).attach(host)
  }

  detach = (terminalSessionId: string, host: HTMLElement): void => {
    const session = this.sessions.get(terminalSessionId)
    session?.detach(host)
  }

  restart = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.restart()
  }

  resynchronizeConnectedViews = (workspaceId: WorkspaceId, workspaceRuntimeId: string): void => {
    for (const session of this.sessions.values()) {
      if (
        terminalSessionCoordinates(session.descriptor).workspaceId !== workspaceId ||
        terminalSessionCoordinates(session.descriptor).workspaceRuntimeId !== workspaceRuntimeId
      )
        continue
      session.resynchronizeConnectedView()
    }
  }

  focusTerminal = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.focus()
  }

  snapshot = (terminalSessionId: string): TerminalSnapshot => {
    const cached = this.snapshotCache.get(terminalSessionId)
    if (cached) return cached
    const session = this.sessions.get(terminalSessionId)
    if (!session) return EMPTY_TERMINAL_SNAPSHOT
    const next = session.snapshot()
    this.snapshotCache.set(terminalSessionId, next)
    return next
  }

  subscribeSnapshot = (terminalSessionId: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.snapshotListeners, terminalSessionId, listener)
  }

  isTerminalFocusTarget = (terminalSessionId: string, target: EventTarget | null): boolean => {
    return this.sessions.get(terminalSessionId)?.isTerminalFocusTarget(target) ?? false
  }

  findNext = (terminalSessionId: string, term: string, incremental?: boolean) => {
    return (
      this.sessions.get(terminalSessionId)?.findNext(term, incremental) ?? {
        resultIndex: -1,
        resultCount: 0,
        found: false,
      }
    )
  }

  findPrevious = (terminalSessionId: string, term: string) => {
    return this.sessions.get(terminalSessionId)?.findPrevious(term) ?? { resultIndex: -1, resultCount: 0, found: false }
  }

  clearSearch = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.clearSearch()
  }

  writeInput = (terminalSessionId: string, data: string, source: TerminalUserInputSource = 'command'): void => {
    this.sessions.get(terminalSessionId)?.writeInput(userTerminalInput(data, source))
  }

  takeover = (terminalSessionId: string): Promise<boolean> => {
    const session = this.sessions.get(terminalSessionId)
    if (!session) return Promise.resolve(false)
    return session.takeover()
  }

  private notifyFilesystemTarget(terminalFilesystemTargetKey: string): void {
    this.filesystemTargetSnapshotCache.delete(terminalFilesystemTargetKey)
    const listeners = this.filesystemTargetListeners.get(terminalFilesystemTargetKey)
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (err) {
          terminalSessionProviderLog.warn('filesystem target listener threw', { terminalFilesystemTargetKey, err })
        }
      }
    }
    const workspaceId = parseTerminalFilesystemTargetKey(terminalFilesystemTargetKey)?.workspaceId
    if (workspaceId) this.notifyWorkspaceBellCountIfChanged(workspaceId)
  }

  private notifySnapshot(terminalSessionId: string): void {
    const listeners = this.snapshotListeners.get(terminalSessionId)
    if (!listeners) return
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch (err) {
        terminalSessionProviderLog.warn('snapshot listener threw', { terminalSessionId, err })
      }
    }
  }

  private notifyAllFilesystemTargets(): void {
    for (const terminalFilesystemTargetKey of Array.from(this.filesystemTargetListeners.keys()))
      this.notifyFilesystemTarget(terminalFilesystemTargetKey)
  }

  private notifyWorkspaceBellCountIfChanged(workspaceId: WorkspaceId): void {
    if (!this.workspaceBellCountListeners.has(workspaceId)) return
    const previous = this.lastPublishedWorkspaceBellCount.get(workspaceId) ?? 0
    const next = this.workspaceBellCount(workspaceId)
    if (previous === next) return
    this.lastPublishedWorkspaceBellCount.set(workspaceId, next)
    this.notifyWorkspaceBellCount(workspaceId)
  }

  private notifyWorkspaceBellCount(workspaceId: WorkspaceId): void {
    const listeners = this.workspaceBellCountListeners.get(workspaceId)
    if (!listeners) return
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch (err) {
        terminalSessionProviderLog.warn('workspace bell count listener threw', { workspaceId, err })
      }
    }
  }

  private notifyAllWorkspaceBellCounts(): void {
    for (const workspaceId of Array.from(this.workspaceBellCountListeners.keys())) {
      this.notifyWorkspaceBellCountIfChanged(workspaceId)
    }
  }

  private subscribeToKeyedListeners(
    listenersMap: Map<string, Set<() => void>>,
    listenerKey: string,
    listener: () => void,
  ): () => void {
    let listeners = listenersMap.get(listenerKey)
    if (!listeners) {
      listeners = new Set()
      listenersMap.set(listenerKey, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = listenersMap.get(listenerKey)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listenersMap.delete(listenerKey)
    }
  }

  private syncTerminalRuntimeSessionIdIndex(
    terminalSessionId: string,
    terminalRuntimeBinding: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number } | null,
  ): void {
    syncTerminalRuntimeSessionIdIndex({
      terminalSessionId,
      terminalRuntimeBinding,
      terminalRuntimeBindingByTerminalSessionId: this.terminalRuntimeBindingByTerminalSessionId,
      terminalSessionIdByTerminalRuntimeSessionId: this.terminalSessionIdByTerminalRuntimeSessionId,
    })
  }

  private notifySession(terminalSessionId: string): void {
    const session = this.sessions.get(terminalSessionId)
    if (session && !this.activateRuntimeBinding(session)) return
    this.syncTerminalRuntimeSessionIdIndex(terminalSessionId, session?.currentRuntimeBinding() ?? null)
    if (session) {
      this.snapshotCache.set(terminalSessionId, session.snapshot())
    } else {
      this.snapshotCache.delete(terminalSessionId)
    }
    this.notifySnapshot(terminalSessionId)
    const terminalFilesystemTargetKey = session ? terminalDescriptorFilesystemTargetKey(session.descriptor) : null
    if (terminalFilesystemTargetKey) this.notifyFilesystemTarget(terminalFilesystemTargetKey)
  }

  /**
   * Single commit barrier for bindings activated by either a direct response
   * response or full reconciliation. No binding is published before a queued
   * future exit is checked and its exact pending bell is consumed.
   */
  private activateRuntimeBinding(session: TerminalSession): boolean {
    const pendingBinding = session.pendingAuthoritativeRuntimeBinding()
    if (pendingBinding) {
      const pendingEventBinding = {
        terminalSessionId: session.descriptor.terminalSessionId,
        workspaceId: terminalSessionCoordinates(session.descriptor).workspaceId,
        workspaceRuntimeId: terminalSessionCoordinates(session.descriptor).workspaceRuntimeId,
        ...pendingBinding,
      }
      const pendingBindingKey = terminalRealtimeEventBindingKey(pendingEventBinding)
      const exited = this.futureExitOrphans.blocksActivation(pendingEventBinding)
      if (exited) {
        this.pendingServerBellByRuntimeBindingKey.delete(pendingBindingKey)
        this.removeSession(session.descriptor.terminalSessionId, {
          dispose: true,
          preserveFutureExits: true,
        })
        return false
      }
      if (!session.commitPendingAuthoritativeHydration(pendingBinding)) return false
    }
    const binding = session.currentRuntimeBinding()
    if (!binding) return true
    const eventBinding = {
      terminalSessionId: session.descriptor.terminalSessionId,
      workspaceId: terminalSessionCoordinates(session.descriptor).workspaceId,
      workspaceRuntimeId: terminalSessionCoordinates(session.descriptor).workspaceRuntimeId,
      ...binding,
    }
    const bindingKey = terminalRealtimeEventBindingKey(eventBinding)
    const exited = this.futureExitOrphans.blocksActivation(eventBinding)
    if (exited) {
      this.pendingServerBellByRuntimeBindingKey.delete(bindingKey)
      this.removeSession(session.descriptor.terminalSessionId, {
        dispose: true,
        preserveFutureExits: true,
      })
      return false
    }
    this.syncTerminalRuntimeSessionIdIndex(session.descriptor.terminalSessionId, binding)
    const pendingBell = this.pendingServerBellByRuntimeBindingKey.get(bindingKey)
    if (pendingBell) this.applyServerBell(session, pendingBell)
    return true
  }

  private removeSession(
    terminalSessionId: string,
    options: { dispose: boolean; preserveFutureExits?: boolean },
  ): boolean {
    const session = this.sessions.get(terminalSessionId)
    if (!session) return false
    const terminalFilesystemTargetKey = terminalDescriptorFilesystemTargetKey(session.descriptor)
    const visibleTerminalSessionIdsBeforeRemoval = this.visibleSessionsForFilesystemTarget(
      terminalFilesystemTargetKey,
    ).map((item) => item.descriptor.terminalSessionId)
    const wasSelected =
      this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) === terminalSessionId
    const runtimeBinding = session.currentRuntimeBinding() ?? session.addressableRuntimeBinding()
    if (runtimeBinding) {
      this.pendingServerBellByRuntimeBindingKey.delete(
        terminalRealtimeEventBindingKey({ terminalSessionId, ...runtimeBinding }),
      )
    }
    if (!options.preserveFutureExits) this.futureExitOrphans.removeSession(terminalSessionId)
    this.syncTerminalRuntimeSessionIdIndex(terminalSessionId, null)
    this.sessions.delete(terminalSessionId)
    this.snapshotCache.delete(terminalSessionId)
    this.removeTerminalSessionIdFromFilesystemTargetList(terminalFilesystemTargetKey, terminalSessionId)
    this.outputActivityState.remove(terminalSessionId)
    this.notifySnapshot(terminalSessionId)
    this.bellState.remove(terminalSessionId)
    if (options.dispose) session.dispose()
    if (wasSelected) {
      const nextSessionId = resolveAdjacentTerminalSelectionAfterRemoval(
        visibleTerminalSessionIdsBeforeRemoval,
        terminalSessionId,
      )
      this.selectTerminalSessionId(terminalFilesystemTargetKey, nextSessionId, { notify: false })
    }
    this.notifyFilesystemTarget(terminalFilesystemTargetKey)
    return true
  }

  private async closeTerminalRuntimeTab(terminalSessionId: string, base: TerminalSessionBase): Promise<boolean> {
    const binding = this.runtimeBindingForClose(terminalSessionId, base)
    const bindingKey = terminalRuntimeBindingKey(binding)
    const pending = this.closeOperationByRuntimeBindingKey.get(bindingKey)
    if (pending) return pending.promise
    let resolve!: (value: boolean) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<boolean>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const operation: TerminalCloseOperation = { binding, promise }
    this.closeOperationByRuntimeBindingKey.set(bindingKey, operation)
    const cleanup = () => {
      if (this.closeOperationByRuntimeBindingKey.get(bindingKey) === operation) {
        this.closeOperationByRuntimeBindingKey.delete(bindingKey)
      }
    }
    void promise.then(cleanup, cleanup)
    void this.runCloseTerminalRuntimeTab(terminalSessionId, base, binding).then(resolve, reject)
    return promise
  }

  private async runCloseTerminalRuntimeTab(
    terminalSessionId: string,
    base: TerminalSessionBase,
    requestedBinding: TerminalRuntimeBindingIdentity,
  ): Promise<boolean> {
    const workspaceRuntimeId = terminalSessionCoordinates(base).workspaceRuntimeId
    let result: WorkspacePaneRuntimeCloseResult
    try {
      result = await workspacePaneRuntimeClient.close({
        runtimeType: 'terminal',
        sessionId: terminalSessionId,
        target: {
          target: base.target,
        },
      })
    } catch (err) {
      terminalSessionProviderLog.warn('terminal close failed', { terminalSessionId, err })
      return false
    }
    if (!result.ok) return false
    this.applyClosedServerSessionEffect(base, result.runtime, requestedBinding)
    void refreshWorkspacePaneTabsQueryData(terminalSessionCoordinates(base).workspaceId, workspaceRuntimeId).catch(
      (err) => {
        terminalSessionProviderLog.warn('terminal closed but workspace pane tabs refresh failed', {
          terminalSessionId,
          workspaceId: terminalSessionCoordinates(base).workspaceId,
          workspaceRuntimeId,
          err,
        })
      },
    )
    return true
  }

  private applyClosedServerSessionEffect(
    base: TerminalSessionBase,
    effect: TerminalWorkspacePaneRuntimeCloseEffect,
    requestedBinding: TerminalRuntimeBindingIdentity,
  ): void {
    const session = this.sessions.get(effect.terminalSessionId)
    if (!session) return
    const effectBinding: TerminalRuntimeBindingIdentity = {
      workspaceId: terminalSessionCoordinates(base).workspaceId,
      workspaceRuntimeId: terminalSessionCoordinates(base).workspaceRuntimeId,
      executionRootId: terminalSessionCoordinates(base).executionRootId,
      terminalSessionId: effect.terminalSessionId,
      terminalRuntimeSessionId:
        effect.terminalRuntimeSessionId ??
        (effect.terminalSessionId === requestedBinding.terminalSessionId
          ? requestedBinding.terminalRuntimeSessionId
          : null),
      terminalRuntimeGeneration:
        effect.terminalRuntimeGeneration ??
        (effect.terminalSessionId === requestedBinding.terminalSessionId
          ? requestedBinding.terminalRuntimeGeneration
          : null),
    }
    if (!this.sessionMatchesRuntimeBinding(session, effectBinding)) {
      const requestedBindingKey = terminalRuntimeBindingKey(requestedBinding)
      if (
        session.currentTerminalRuntimeSessionId() !== null ||
        terminalRuntimeBindingKey(effectBinding) !== requestedBindingKey ||
        !this.closeOperationByRuntimeBindingKey.has(requestedBindingKey)
      ) {
        return
      }
    }
    if (effectBinding.terminalRuntimeSessionId) {
      this.pendingServerBellByRuntimeBindingKey.delete(
        terminalRealtimeEventBindingKey({
          terminalSessionId: effectBinding.terminalSessionId,
          terminalRuntimeSessionId: effectBinding.terminalRuntimeSessionId,
          terminalRuntimeGeneration: effectBinding.terminalRuntimeGeneration ?? 0,
        }),
      )
    }
    this.removeSession(effect.terminalSessionId, { dispose: true })
  }

  private runtimeBindingForClose(terminalSessionId: string, base: TerminalSessionBase): TerminalRuntimeBindingIdentity {
    const session = this.sessions.get(terminalSessionId)
    const workspaceRuntimeId = terminalSessionCoordinates(base).workspaceRuntimeId
    const addressableBinding =
      session &&
      terminalSessionCoordinates(session.descriptor).workspaceId === terminalSessionCoordinates(base).workspaceId &&
      terminalSessionCoordinates(session.descriptor).workspaceRuntimeId === workspaceRuntimeId &&
      terminalSessionCoordinates(session.descriptor).executionRootId ===
        terminalSessionCoordinates(base).executionRootId
        ? session.addressableRuntimeBinding()
        : null
    return {
      workspaceId: terminalSessionCoordinates(base).workspaceId,
      workspaceRuntimeId,
      executionRootId: terminalSessionCoordinates(base).executionRootId,
      terminalSessionId,
      terminalRuntimeSessionId: addressableBinding?.terminalRuntimeSessionId ?? null,
      terminalRuntimeGeneration: addressableBinding?.terminalRuntimeGeneration ?? null,
    }
  }

  private runtimeBindingForSession(
    session: TerminalSession,
    terminalRuntimeSessionId: string,
    terminalRuntimeGeneration: number | null = session.currentRuntimeBinding()?.terminalRuntimeGeneration ?? null,
  ): TerminalRuntimeBindingIdentity | null {
    const workspaceRuntimeId = terminalSessionCoordinates(session.descriptor).workspaceRuntimeId
    if (!workspaceRuntimeId) return null
    return {
      workspaceId: terminalSessionCoordinates(session.descriptor).workspaceId,
      workspaceRuntimeId,
      executionRootId: terminalSessionCoordinates(session.descriptor).executionRootId,
      terminalSessionId: session.descriptor.terminalSessionId,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration,
    }
  }

  private sessionMatchesRuntimeBinding(session: TerminalSession, binding: TerminalRuntimeBindingIdentity): boolean {
    return (
      terminalSessionCoordinates(session.descriptor).workspaceId === binding.workspaceId &&
      terminalSessionCoordinates(session.descriptor).workspaceRuntimeId === binding.workspaceRuntimeId &&
      terminalSessionCoordinates(session.descriptor).executionRootId === binding.executionRootId &&
      session.descriptor.terminalSessionId === binding.terminalSessionId &&
      session.currentRuntimeBinding()?.terminalRuntimeSessionId === binding.terminalRuntimeSessionId &&
      session.currentRuntimeBinding()?.terminalRuntimeGeneration === binding.terminalRuntimeGeneration
    )
  }

  private hasPendingCloseForSession(session: TerminalSession): boolean {
    const addressableTerminalRuntimeSessionId = session.addressableRuntimeBinding()?.terminalRuntimeSessionId ?? null
    for (const operation of this.closeOperationByRuntimeBindingKey.values()) {
      const binding = operation.binding
      if (
        binding.workspaceId !== terminalSessionCoordinates(session.descriptor).workspaceId ||
        binding.workspaceRuntimeId !== terminalSessionCoordinates(session.descriptor).workspaceRuntimeId ||
        binding.executionRootId !== terminalSessionCoordinates(session.descriptor).executionRootId ||
        binding.terminalSessionId !== session.descriptor.terminalSessionId
      ) {
        continue
      }
      if (
        addressableTerminalRuntimeSessionId === binding.terminalRuntimeSessionId ||
        addressableTerminalRuntimeSessionId === null
      ) {
        return true
      }
    }
    return false
  }

  private discardLocalSessionAndDismissDetailIfLast(
    terminalSessionId: string,
    base: TerminalSessionBase,
    binding?: TerminalRuntimeBindingIdentity | null,
    preserveFutureExits = false,
  ): void {
    if (binding && this.closeOperationByRuntimeBindingKey.has(terminalRuntimeBindingKey(binding))) return
    const candidateSession = this.sessions.get(terminalSessionId)
    if (candidateSession && this.hasPendingCloseForSession(candidateSession)) return
    const session = this.sessions.get(terminalSessionId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(
      terminalSessionCoordinates(base).workspaceId,
      terminalSessionCoordinates(base).executionRootId,
    )
    if (!session || terminalDescriptorFilesystemTargetKey(session.descriptor) !== terminalFilesystemTargetKey) return
    this.removeSession(terminalSessionId, { dispose: true, preserveFutureExits })
  }

  private pruneSessionsMissingFromRuntimeMembership(): void {
    const sessionIdsToRemove = Array.from(this.sessions.entries())
      .filter(([, session]) => !this.sessionBelongsToCurrentRuntimeMembership(session))
      .map(([terminalSessionId]) => terminalSessionId)
    for (const terminalSessionId of sessionIdsToRemove) this.removeSession(terminalSessionId, { dispose: true })
  }

  private sessionBelongsToCurrentRuntimeMembership(session: TerminalSession): boolean {
    const current = this.runtimeMembershipIndex.get(terminalSessionCoordinates(session.descriptor).workspaceId)
    if (!current) return false
    return current.workspaceRuntimeId === terminalSessionCoordinates(session.descriptor).workspaceRuntimeId
  }

  private ensureSession(descriptor: TerminalDescriptor): TerminalSession {
    const current = this.sessions.get(descriptor.terminalSessionId)
    this.appendTerminalSessionIdToFilesystemTargetList(
      terminalDescriptorFilesystemTargetKey(descriptor),
      descriptor.terminalSessionId,
    )
    if (current) {
      current.updateDescriptor(descriptor)
      this.syncTerminalRuntimeSessionIdIndex(
        descriptor.terminalSessionId,
        current.currentRuntimeBinding() ??
          this.terminalRuntimeBindingByTerminalSessionId.get(descriptor.terminalSessionId) ??
          null,
      )
      this.notifyFilesystemTarget(terminalDescriptorFilesystemTargetKey(descriptor))
      return current
    }
    const session = new TerminalSession(
      descriptor,
      (...notification) => {
        const [reason, projectionDeltaRevision] = notification
        if (reason === 'projection-delta-revision') {
          if (projectionDeltaRevision === undefined) throw new Error('terminal projection delta revision missing')
          this.applyTerminalSessionsDeltaRevision(terminalSessionCoordinates(descriptor), projectionDeltaRevision)
          return
        }
        this.notifySession(descriptor.terminalSessionId)
      },
      this.writeFailureReporter,
    )
    this.sessions.set(descriptor.terminalSessionId, session)
    this.syncTerminalRuntimeSessionIdIndex(descriptor.terminalSessionId, session.currentRuntimeBinding())
    this.snapshotCache.set(descriptor.terminalSessionId, session.snapshot())
    if (
      !this.selectedTerminalSessionIdByTerminalFilesystemTarget.has(terminalDescriptorFilesystemTargetKey(descriptor))
    ) {
      const preferred = this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.get(
        terminalDescriptorFilesystemTargetKey(descriptor),
      )
      if (!preferred || preferred === descriptor.terminalSessionId)
        this.selectTerminalSessionId(terminalDescriptorFilesystemTargetKey(descriptor), descriptor.terminalSessionId, {
          notify: false,
        })
    }
    this.notifyFilesystemTarget(terminalDescriptorFilesystemTargetKey(descriptor))
    return session
  }

  private selectTerminalSessionId(
    terminalFilesystemTargetKey: string,
    terminalSessionId: string | null,
    options: { notify?: boolean } = {},
  ): void {
    const next =
      terminalSessionId && this.isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey, terminalSessionId)
        ? terminalSessionId
        : null
    const current = this.selectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null
    if (current === next) {
      this.setPreferredSelectedTerminalSessionId(terminalFilesystemTargetKey, next)
      return
    }
    if (next) {
      this.selectedTerminalSessionIdByTerminalFilesystemTarget.set(terminalFilesystemTargetKey, next)
    } else {
      this.selectedTerminalSessionIdByTerminalFilesystemTarget.delete(terminalFilesystemTargetKey)
    }
    this.setPreferredSelectedTerminalSessionId(terminalFilesystemTargetKey, next)
    if (options.notify !== false) this.notifyFilesystemTarget(terminalFilesystemTargetKey)
  }

  private setPreferredSelectedTerminalSessionId(
    terminalFilesystemTargetKey: string,
    terminalSessionId: string | null,
  ): void {
    const current =
      this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? null
    if (current === terminalSessionId) return
    if (terminalSessionId)
      this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.set(
        terminalFilesystemTargetKey,
        terminalSessionId,
      )
    else this.preferredSelectedTerminalSessionIdByTerminalFilesystemTarget.delete(terminalFilesystemTargetKey)
    this.onSelectedFilesystemTargetChange(terminalFilesystemTargetKey, terminalSessionId)
  }

  private isSelectedTerminalSessionIdValid(terminalFilesystemTargetKey: string, terminalSessionId: string): boolean {
    const descriptor = this.sessions.get(terminalSessionId)?.descriptor
    return !!descriptor && terminalDescriptorFilesystemTargetKey(descriptor) === terminalFilesystemTargetKey
  }

  private visibleSessionsForFilesystemTarget(terminalFilesystemTargetKey: string): TerminalSession[] {
    return this.sessionsForFilesystemTargetList(terminalFilesystemTargetKey)
  }

  private sessionsForFilesystemTargetList(terminalFilesystemTargetKey: string): TerminalSession[] {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => terminalDescriptorFilesystemTargetKey(session.descriptor) === terminalFilesystemTargetKey,
    )
    const terminalSessionByTerminalSessionId = new Map(
      sessions.map((session) => [session.descriptor.terminalSessionId, session]),
    )
    const seen = new Set<string>()
    const listedSessions: TerminalSession[] = []
    for (const terminalSessionId of this.terminalSessionIdsByTerminalFilesystemTarget.get(
      terminalFilesystemTargetKey,
    ) ?? []) {
      const session = terminalSessionByTerminalSessionId.get(terminalSessionId)
      if (!session || seen.has(terminalSessionId)) continue
      seen.add(terminalSessionId)
      listedSessions.push(session)
    }
    for (const session of sessions) {
      const terminalSessionId = session.descriptor.terminalSessionId
      if (seen.has(terminalSessionId)) continue
      seen.add(terminalSessionId)
      listedSessions.push(session)
    }
    return listedSessions
  }

  private appendTerminalSessionIdToFilesystemTargetList(
    terminalFilesystemTargetKey: string,
    terminalSessionId: string,
  ): void {
    const current = this.terminalSessionIdsByTerminalFilesystemTarget.get(terminalFilesystemTargetKey)
    if (current?.includes(terminalSessionId)) return
    this.terminalSessionIdsByTerminalFilesystemTarget.set(terminalFilesystemTargetKey, [
      ...(current ?? []),
      terminalSessionId,
    ])
  }

  private removeTerminalSessionIdFromFilesystemTargetList(
    terminalFilesystemTargetKey: string,
    terminalSessionId: string,
  ): void {
    const current = this.terminalSessionIdsByTerminalFilesystemTarget.get(terminalFilesystemTargetKey)
    if (!current) return
    const next = current.filter((candidate) => candidate !== terminalSessionId)
    if (next.length === current.length) return
    if (next.length === 0) this.terminalSessionIdsByTerminalFilesystemTarget.delete(terminalFilesystemTargetKey)
    else this.terminalSessionIdsByTerminalFilesystemTarget.set(terminalFilesystemTargetKey, next)
  }

  private replaceTerminalSessionIdListForTouchedFilesystemTargets(
    nextByFilesystemTarget: ReadonlyMap<string, readonly string[]>,
  ): Set<string> {
    const changedFilesystemTargets = new Set<string>()
    for (const [terminalFilesystemTargetKey, terminalSessionIds] of nextByFilesystemTarget) {
      const next = uniqueNonEmptyStrings(terminalSessionIds)
      const current = this.terminalSessionIdsByTerminalFilesystemTarget.get(terminalFilesystemTargetKey) ?? []
      if (stringArraysEqual(current, next)) continue
      if (next.length === 0) this.terminalSessionIdsByTerminalFilesystemTarget.delete(terminalFilesystemTargetKey)
      else this.terminalSessionIdsByTerminalFilesystemTarget.set(terminalFilesystemTargetKey, next)
      changedFilesystemTargets.add(terminalFilesystemTargetKey)
    }
    return changedFilesystemTargets
  }
}

async function resolveTerminalCreateOptions(options: TerminalCreateOptions): Promise<ResolvedTerminalCreateOptions> {
  if (options.startupShellCommand && options.resolveStartupShellCommand) {
    throw new Error('startupShellCommand cannot be combined with resolveStartupShellCommand')
  }
  const startupShellCommand = options.resolveStartupShellCommand
    ? await options.resolveStartupShellCommand()
    : options.startupShellCommand
  return {
    ...(startupShellCommand ? { startupShellCommand } : {}),
  }
}

async function resolveTerminalCreateOptionsUntilCreateSettles(
  options: TerminalCreateOptions,
  createPromise: Promise<unknown>,
): Promise<ResolvedTerminalCreateOptions> {
  const resolution = resolveTerminalCreateOptions(options)
  const cancellation = new Promise<never>((_, reject) => {
    void createPromise.catch(reject)
  })
  try {
    return await Promise.race([resolution, cancellation])
  } finally {
    void resolution.catch(() => {})
  }
}

function pushUniqueMapList(map: Map<string, string[]>, mapKey: string, value: string): void {
  const current = map.get(mapKey)
  if (!current) {
    map.set(mapKey, [value])
    return
  }
  if (!current.includes(value)) current.push(value)
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((value, index) => a[index] === value)
}

export interface TerminalSessionProjectionDeps {
  onSelectedFilesystemTargetChange: (terminalFilesystemTargetKey: string, terminalSessionId: string | null) => void
}

let projectionInstance: TerminalSessionProjection | null = null

/**
 * Lazy getter for the client-level terminal session projection.
 *
 * First call constructs the singleton with `deps` (only the first
 * call's deps are honored — subsequent calls return the existing
 * instance even if deps differ, because the singleton is meant to
 * outlive any Provider remount). App runtime projection wiring is the
 * canonical app caller; tests inject via `setTerminalSessionProjectionForTests`.
 *
 * Mirrors the `getClientBridge()` shape at
 * `src/web/client-bridge.ts`.
 */
export function getTerminalSessionProjection(deps: TerminalSessionProjectionDeps): TerminalSessionProjection {
  if (!projectionInstance) {
    projectionInstance = new TerminalSessionProjection(deps.onSelectedFilesystemTargetChange)
  }
  return projectionInstance
}

/**
 * Test seam: install or clear the singleton projection. Tests should:
 *
 * 1. In `beforeEach`: construct a fresh `TerminalSessionProjection` and
 *    install it with `setTerminalSessionProjectionForTests(instance)`.
 * 2. In `afterEach`: call `setTerminalSessionProjectionForTests(null)`.
 *    If the per-test instance needs to drain pending promises or
 *    clear listener maps, call `projection.destroy()` on the local
 *    reference before clearing the session.
 *
 * Production code never calls this. Mirrors
 * `setClientBridgeForTests()` at `src/web/client-bridge.ts`.
 */
export function setTerminalSessionProjectionForTests(instance: TerminalSessionProjection | null): void {
  projectionInstance = instance
}
