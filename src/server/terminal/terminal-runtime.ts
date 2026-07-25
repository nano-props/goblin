// Server-side terminal runtime. Single holder of the business state
// for a Goblin server instance: the session manager, the session service, the
// realtime broker, the connection-state tracker, and the realtime
// dispatch table. Exposes a `ServerTerminalHost` to the Hono realtime
// route. Holds no PTY state itself — the `PtySupervisor` injected at
// construction owns the PTY pool (in-process or worker-backed).
//
// Layering: this file is the server-side "write" layer for the
// terminal feature. Routes call into it; nothing inside it calls out
// to the route layer.

import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { terminalSessionCoordinates, type TerminalSessionsChangedEvent } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { serverLogger } from '#/server/logger.ts'
import {
  createTerminalSessionService,
  terminalWorkspacePaneRuntimeTabsProvider,
} from '#/server/terminal/terminal-session-service.ts'
import {
  createWorkspacePaneTabsCoordinator,
  type WorkspacePaneTargetProjectionProvider,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { WorkspacePaneTargetCatalog } from '#/server/workspace-pane/workspace-pane-target-catalog.ts'
import { WorkspacePaneLayoutAggregate } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { workspacePaneDurableLayoutsEqual } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'
import { createTerminalRuntimeCoordinator } from '#/server/terminal/terminal-runtime-coordinator.ts'
import { createWorkspacePaneTabsActions } from '#/server/workspace-pane/workspace-pane-tabs-actions.ts'
import {
  broadcastWorkspacePaneTabsChanged,
  broadcastWorkspacePaneTabsRevision,
} from '#/server/workspace-pane/workspace-pane-tabs-realtime.ts'
import { createTerminalRealtimeHandlers } from '#/server/terminal/terminal-runtime-realtime.ts'
import { createWorkspacePaneTabsRealtimeHandlers } from '#/server/workspace-pane/workspace-pane-tabs-runtime-realtime.ts'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { createWorkspacePaneRuntimeRealtimeHandlers } from '#/server/workspace-pane/workspace-pane-runtime-realtime.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import {
  serverWorkspacePaneLayoutRepository,
  serverWorkspacePaneLayoutRestoreTransaction,
} from '#/server/modules/settings-source.ts'
import { isValidTerminalClientId, isValidTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { TerminalSessionManager, type TerminalSessionCloseReason } from '#/server/terminal/terminal-session-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalActionHost, type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { GoblinTerminalCommandRuntime } from '#/server/terminal/g-command.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import {
  isCurrentWorkspaceRuntime,
  isCurrentWorkspaceRuntimeMembership,
  onWorkspaceRuntimeClosed,
  retainWorkspaceRuntimeResource,
} from '#/server/modules/workspace-runtimes.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { createAppRealtimeHost } from '#/server/realtime/app-realtime-runtime.ts'
import { createWorktreeRemovalApplication } from '#/server/worktree-removal/worktree-removal-application.ts'
import { createPhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { createTerminalSessionCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up. (The previous revision also kept a 30s controller grace
// timer here; it has been removed — controller effectiveness now derives from
// broker presence.)
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
// Realtime presence detects a disconnected page. This additional grace absorbs
// a normal socket reconnect without retaining an expired page's memberships,
// background targets, or terminal authority for the terminal session TTL.
const CLIENT_STATE_DISCONNECT_GRACE_MS = 30_000
const terminalRuntimeLogger = serverLogger.child({ module: 'terminal-runtime' })

const serverWorkspacePaneTargetProjection = new WorkspacePaneTargetCatalog()

export interface ServerTerminalRuntimeOptions {
  ptySupervisor: PtySupervisor
  gCommand?: GoblinTerminalCommandRuntime
  workspacePaneLayoutRepository?: WorkspacePaneLayoutRepository
  workspacePaneLayoutRestoreTransaction?: WorkspacePaneLayoutRestoreTransaction
  workspacePaneTargetProjection?: WorkspacePaneTargetProjectionProvider
}

export interface ServerTerminalRuntime {
  host: ServerTerminalHost
  workspacePaneRuntimeHost: ServerWorkspacePaneRuntimeHost
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspacePaneRuntimeApplication: ReturnType<typeof createWorkspacePaneRuntimeApplication>
  worktreeRemovalApplication: ReturnType<typeof createWorktreeRemovalApplication>
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  shutdown(): void
}

export function createServerTerminalRuntime(options: ServerTerminalRuntimeOptions): ServerTerminalRuntime {
  const { ptySupervisor } = options
  const workspacePaneLayoutRepository = options.workspacePaneLayoutRepository ?? serverWorkspacePaneLayoutRepository
  const workspacePaneLayout = new WorkspacePaneLayoutAggregate({
    repository: workspacePaneLayoutRepository,
    restoreTransaction: options.workspacePaneLayoutRestoreTransaction ?? serverWorkspacePaneLayoutRestoreTransaction,
  })
  const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
  const physicalWorktrees = createPhysicalWorktreeIdentityResolver()
  // Sink callbacks fan out to every clientId that shares the
  // session's userId. The manager passes `userId` (a string
  // derived from the access token) rather than `clientId`, so a
  // live output event reaches a sibling tab (different `clientId`,
  // same `userId`) without an extra attach roundtrip. See
  // `identity.ts` for the model.
  let broker: RealtimeBroker<AppRealtimeMessage>
  let sessionService: ReturnType<typeof createTerminalSessionService>
  const manager = new TerminalSessionManager<string>(
    ptySupervisor,
    {
      onOutput(userId, event) {
        broker.broadcastToUser(userId, { type: 'output', event })
      },
      onBell(userId, event) {
        broker.broadcastToUser(userId, { type: 'bell', event })
      },
      onTitle(userId, event) {
        broker.broadcastToUser(userId, { type: 'title', event })
      },
      onExit(userId, event) {
        broker.broadcastToUser(userId, { type: 'exit', event })
      },
      onSessionClosed(userId, session, reason) {
        return handleSessionClosed(userId, session, reason)
      },
      onIdentity(userId, event) {
        broker.broadcastToUser(userId, { type: 'identity', event })
      },
      onLifecycle(userId, event) {
        broker.broadcastToUser(userId, { type: 'lifecycle', event })
      },
      onSessionsProjectionChanged(userId, event) {
        broadcastTerminalSessionsChanged(userId, event)
      },
    },
    (userId, clientId) => broker.isClientOnline(userId, clientId),
    {
      retain(userId, workspaceId, workspaceRuntimeId, terminalRuntimeSessionId) {
        return retainWorkspaceRuntimeResource(userId, workspaceId, workspaceRuntimeId, terminalRuntimeSessionId)
      },
    },
  )
  const workspaceTabsCoordinator = createWorkspacePaneTabsCoordinator({
    runtimeProviders: [terminalWorkspacePaneRuntimeTabsProvider(manager)],
    worktreeOperations,
    physicalWorktrees,
    layoutAggregate: workspacePaneLayout,
    targetProjection: options.workspacePaneTargetProjection ?? serverWorkspacePaneTargetProjection,
  })
  const coordinator = createTerminalRuntimeCoordinator({
    manager,
    workspaceTabsCoordinator,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
    clientStateTtlMs: CLIENT_STATE_DISCONNECT_GRACE_MS,
  })
  broker = coordinator.broker
  sessionService = createTerminalSessionService({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalSessionId,
    manager,
    workspaceTabsCoordinator,
    isCurrentWorkspaceRuntime: isCurrentWorkspaceRuntime,
    broadcastWorkspaceTabsChanged(userId, workspaceId) {
      publishWorkspaceTabsChanged(userId, workspaceId)
    },
    gCommand: options.gCommand,
  })
  const unsubscribeWorkspaceRuntimeClosed = onWorkspaceRuntimeClosed((event) => {
    const scope = terminalSessionRuntimeScope(event.workspaceId, event.workspaceRuntimeId)
    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(event.userId, scope)
    const sessionsChangedEvent = manager.terminalSessionsChangedEventForScope(
      event.userId,
      event.workspaceId,
      event.workspaceRuntimeId,
    )
    manager.releaseProjectionRevisionForScope(event.userId, scope)
    retireInvalidatedScopeProjection({
      userId: event.userId,
      workspaceId: event.workspaceId,
      workspaceRuntimeId: event.workspaceRuntimeId,
      scope,
    })
    invalidation.publishEffects()
    try {
      broadcastTerminalSessionsChanged(event.userId, sessionsChangedEvent)
    } catch (error) {
      terminalRuntimeLogger.warn(
        {
          userId: event.userId,
          workspaceId: event.workspaceId,
          workspaceRuntimeId: event.workspaceRuntimeId,
          err: error,
        },
        'failed to publish invalidated workspace runtime sessions',
      )
    }
  })

  function retireInvalidatedScopeProjection(input: {
    userId: string
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    scope: string
  }): void {
    void workspaceTabsCoordinator
      .closeScope({ userId: input.userId, scope: input.scope })
      .then(() => {
        publishWorkspaceTabsChanged(input.userId, input.workspaceId)
      })
      .catch((error) => {
        terminalRuntimeLogger.warn(
          {
            userId: input.userId,
            workspaceId: input.workspaceId,
            workspaceRuntimeId: input.workspaceRuntimeId,
            err: error,
          },
          'failed to retire invalidated workspace runtime workspace tabs',
        )
      })
  }

  let shuttingDown = false
  const actions = createTerminalRuntimeActions({
    manager,
    broker,
    sessionService,
    isValidTerminalClientId,
    isCurrentWorkspaceRuntimeMembership,
    worktreeOperations,
  })
  const terminalCreateProvider = createTerminalSessionCreateProvider({ sessionService, worktreeOperations })
  const workspacePaneRuntimeApplication = createWorkspacePaneRuntimeApplication({
    workspaceTabsCoordinator,
    worktreeOperations,
    physicalWorktrees,
    terminal: { ...terminalCreateProvider, close: actions.closeForWorkspacePane },
    terminalSessions: manager,
    isCurrentWorkspaceRuntimeMembership,
    broadcastWorkspaceTabsChanged: publishWorkspaceTabsRevision,
  })
  const worktreeRemovalApplication = createWorktreeRemovalApplication({
    worktreeOperations,
    physicalWorktrees,
    terminalSessions: manager,
    workspaceTabs: workspaceTabsCoordinator,
    isCurrentWorkspaceRuntime,
    broadcastSessionsChanged(userId, workspaceId, workspaceRuntimeId) {
      broadcastTerminalSessionsChanged(
        userId,
        manager.terminalSessionsChangedEventForScope(userId, workspaceId, workspaceRuntimeId),
      )
    },
    broadcastWorkspaceTabsChanged: publishWorkspaceTabsChanged,
  })
  const workspacePaneRuntimeHost: ServerWorkspacePaneRuntimeHost = {
    async openRuntime(clientId, userId, input) {
      return await workspacePaneRuntimeApplication.open(clientId, userId, input)
    },
    async closeRuntime(clientId, userId, input) {
      return await workspacePaneRuntimeApplication.close(clientId, userId, input)
    },
  }
  const workspacePaneTabsActions = createWorkspacePaneTabsActions({
    sessionService,
    isValidClientId: isValidTerminalClientId,
    isCurrentWorkspaceRuntimeMembership,
  })
  const workspacePaneTabsHost: ServerWorkspacePaneTabsHost = {
    async restoreTabs(userId, input) {
      return await sessionService.restoreTabs(userId, input)
    },
    async listWorkspaceTabs(clientId, userId, input) {
      return await workspacePaneTabsActions.listWorkspaceTabs(clientId, userId, input)
    },
    async replaceTabs(clientId, userId, input) {
      return await workspacePaneTabsActions.replaceTabs(clientId, userId, input)
    },
    async updateTabs(clientId, userId, input) {
      return await workspacePaneTabsActions.updateTabs(clientId, userId, input)
    },
  }

  const terminalActionHost: ServerTerminalActionHost = {
    isClientOnline(userId, clientId) {
      return broker.isClientOnline(userId, clientId)
    },
    async attach(clientId, userId, input) {
      return await actions.attach(clientId, userId, input)
    },
    async restart(clientId, userId, input) {
      return await actions.restart(clientId, userId, input)
    },
    write(clientId, userId, input) {
      return actions.write(clientId, userId, input)
    },
    resize(clientId, userId, input) {
      return actions.resize(clientId, userId, input)
    },
    takeover(clientId, userId, input) {
      return actions.takeover(clientId, userId, input)
    },
    async close(clientId, userId, input) {
      return await actions.close(clientId, userId, input)
    },
    async listSessions(clientId, userId, input) {
      return await actions.listSessions(clientId, userId, input)
    },
    async recoverSessions(clientId, userId, input) {
      return await actions.recoverSessions(clientId, userId, input)
    },
    async prune(clientId, userId, input) {
      return await actions.prune(clientId, userId, input)
    },
  }

  const realtimeHandlers = createTerminalRealtimeHandlers(terminalActionHost)
  const workspacePaneTabsRealtimeHandlers = createWorkspacePaneTabsRealtimeHandlers(workspacePaneTabsHost)
  const workspacePaneRuntimeRealtimeHandlers = createWorkspacePaneRuntimeRealtimeHandlers(workspacePaneRuntimeHost)
  const appRealtimeHost = createAppRealtimeHost({
    broker,
    isValidClientId: isValidTerminalClientId,
    getDiagnostics() {
      return {
        terminal: {
          mode: ptySupervisor.getDiagnostics().mode,
          state: shuttingDown ? 'shutting-down' : 'running',
          registeredSockets: broker.socketCount(),
          shuttingDown,
          pty: ptySupervisor.getDiagnostics(),
          liveSessionCount: manager.getSessionCount(),
        },
      }
    },
    terminalHandlers: realtimeHandlers,
    workspacePaneTabsHandlers: workspacePaneTabsRealtimeHandlers,
    workspacePaneRuntimeHandlers: workspacePaneRuntimeRealtimeHandlers,
    onShutdown() {
      if (shuttingDown) return
      shuttingDown = true
      unsubscribeWorkspaceRuntimeClosed()
      physicalWorktrees.dispose()
      coordinator.shutdown()
      manager.forceShutdown()
      ptySupervisor.shutdown()
    },
  })

  const host: ServerTerminalHost = {
    ...appRealtimeHost,
    ...terminalActionHost,
    shutdown() {
      appRealtimeHost.shutdown()
    },
  }

  terminalRuntimeLogger.info({ ptyMode: ptySupervisor.getDiagnostics().mode }, 'server terminal runtime created')

  const workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost = {
    async commitGitCapabilityRemoval({ userId, workspaceId, workspaceRuntimeId, assertCurrent }) {
      const scope = terminalSessionRuntimeScope(workspaceId, workspaceRuntimeId)
      let durableLayoutChanged: boolean
      try {
        assertCurrent()
        durableLayoutChanged = await clearWorkspacePaneDurableLayout(workspacePaneLayoutRepository, workspaceId)
      } catch (error) {
        return { kind: 'failed-before-commit', error }
      }

      // The accepted durable CAS is the capability-removal commit point.
      // Register overlay retirement before detaching terminal authority; the
      // queued effect cannot run until this synchronous commit returns.
      retireInvalidatedScopeProjection({
        userId,
        workspaceId,
        workspaceRuntimeId: workspaceRuntimeId,
        scope,
      })
      const terminalInvalidation = manager.commitGitSessionInvalidation(userId, scope)
      terminalInvalidation.publishEffects()
      if (durableLayoutChanged || terminalInvalidation.removedCount > 0) {
        try {
          broadcastTerminalSessionsChanged(
            userId,
            manager.terminalSessionsChangedEventForScope(userId, workspaceId, workspaceRuntimeId),
          )
        } catch (error) {
          terminalRuntimeLogger.warn(
            { userId, workspaceId, workspaceRuntimeId, err: error },
            'failed to publish committed terminal invalidation',
          )
        }
      }
      return { kind: 'committed' }
    },
  }

  return {
    host,
    workspacePaneRuntimeHost,
    workspacePaneTabsHost,
    workspacePaneRuntimeApplication,
    worktreeRemovalApplication,
    workspaceCapabilityTransitionHost,
    shutdown() {
      host.shutdown()
    },
  }

  function broadcastTerminalSessionsChanged(userId: string, event: TerminalSessionsChangedEvent): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', ...event })
  }

  function publishWorkspaceTabsChanged(userId: string, workspaceId: WorkspaceId): void {
    broadcastWorkspacePaneTabsChanged(broker, userId, workspaceId)
  }

  function publishWorkspaceTabsRevision(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    revision: number,
  ): void {
    broadcastWorkspacePaneTabsRevision(broker, userId, workspaceId, workspaceRuntimeId, revision)
  }

  function handleSessionClosed(
    userId: string,
    session: TerminalSessionSummary,
    reason: TerminalSessionCloseReason,
  ): void | Promise<void> {
    if (reason !== 'session' && reason !== 'workspace-pane') return
    const coordinates = terminalSessionCoordinates(session)
    broadcastTerminalSessionsChanged(
      userId,
      manager.terminalSessionsChangedEventForScope(userId, coordinates.workspaceId, coordinates.workspaceRuntimeId),
    )
    // The composed workspace-pane close reconciles tabs under its existing
    // physical-worktree permit and returns that canonical snapshot. General
    // session retirement has no such command boundary, so it reconciles here.
    if (reason === 'workspace-pane') return
    return sessionService
      .reconcileTerminalTabsForSession(userId, session)
      .then(() => {
        publishWorkspaceTabsChanged(userId, coordinates.workspaceId)
      })
      .catch((err) => {
        terminalRuntimeLogger.warn(
          {
            userId,
            terminalRuntimeSessionId: session.terminalRuntimeSessionId,
            workspaceId: coordinates.workspaceId,
            err,
          },
          'failed to reconcile workspace tabs after terminal session close',
        )
      })
  }
}

async function clearWorkspacePaneDurableLayout(
  repository: WorkspacePaneLayoutRepository,
  workspaceId: WorkspaceId,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await repository.load(workspaceId)
    const replacement = {
      entries: current.layout.entries.filter((entry) => entry.target.kind === 'workspace-root'),
    }
    if (workspacePaneDurableLayoutsEqual(workspaceId, current.layout, replacement)) return false
    const outcome = await repository.compareAndSwap({
      workspaceId,
      expected: current.layout,
      replacement,
    })
    if (outcome.kind === 'accepted') return outcome.changed
    if (outcome.kind === 'write-failure') throw outcome.error
  }
  throw new Error('workspace pane layout cleanup was superseded')
}
