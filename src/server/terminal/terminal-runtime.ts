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
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { serverLogger } from '#/server/logger.ts'
import {
  createTerminalSessionService,
  terminalWorkspacePaneRuntimeTabsProvider,
} from '#/server/terminal/terminal-session-service.ts'
import {
  createWorkspacePaneTabsCoordinator,
  type WorkspacePaneTargetProjectionProvider,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
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
import { isCurrentRepoRuntime, onRepoRuntimeClosed } from '#/server/modules/repo-runtimes.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { createAppRealtimeHost } from '#/server/realtime/app-realtime-runtime.ts'
import { createWorktreeRemovalApplication } from '#/server/worktree-removal/worktree-removal-application.ts'
import { createPhysicalWorktreeIdentityResolver } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { createTerminalSessionCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { getRepoSnapshot } from '#/server/modules/repo-read-paths.ts'
import { workspaceRuntimeHasGitCapability } from '#/server/modules/repo-runtimes.ts'
import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
} from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up. (The previous revision also kept a 30s controller grace
// timer here; it has been removed — controller effectiveness now derives from
// broker presence.)
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
// A window's repo membership survives the same long disconnect window as its
// terminals, but remains a separate policy input so the two lifecycles are not
// structurally coupled if product retention changes later.
const REPO_RUNTIME_MEMBERSHIP_TTL_MS = 24 * 60 * 60 * 1000
const INVALIDATED_SCOPE_RETIREMENT_RETRY_BASE_MS = 100
const INVALIDATED_SCOPE_RETIREMENT_RETRY_MAX_MS = 5_000
const terminalRuntimeLogger = serverLogger.child({ module: 'terminal-runtime' })

const serverWorkspacePaneTargetProjection: WorkspacePaneTargetProjectionProvider = {
  async captureTargets(userId, repoRoot, scope) {
    const separator = scope.lastIndexOf('\0')
    if (separator < 0 || separator === scope.length - 1) throw new Error('invalid workspace pane runtime scope')
    const repoRuntimeId = scope.slice(separator + 1)
    const workspaceId = canonicalWorkspaceLocator(repoRoot)
    if (!workspaceId) throw new Error('invalid workspace pane workspace id')
    const workspace = parseCanonicalWorkspaceLocator(workspaceId)
    if (!workspace) throw new Error('invalid workspace pane workspace id')
    const workspaceTarget = {
      target: { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: repoRuntimeId },
      nativeWorktreePath: workspace.path,
      canonicalBranch: null,
    }
    if (!workspaceRuntimeHasGitCapability(userId, repoRoot, repoRuntimeId)) return [workspaceTarget]
    const snapshot = await getRepoSnapshot(repoRoot, { repoRuntimeId })
    return [
      workspaceTarget,
      ...(snapshot?.branches ?? []).map((branch) =>
        branch.worktree
          ? {
              target: {
                kind: 'git-worktree' as const,
                workspaceId,
                workspaceRuntimeId: repoRuntimeId,
                root: workspaceLocatorForNativePath(workspaceId, branch.worktree.path),
              },
              nativeWorktreePath: branch.worktree.path,
              canonicalBranch: branch.name,
            }
          : {
              target: {
                kind: 'git-branch' as const,
                workspaceId,
                workspaceRuntimeId: repoRuntimeId,
                branch: branch.name,
              },
              nativeWorktreePath: null,
              canonicalBranch: branch.name,
            },
      ),
    ]
  },
}

function workspaceLocatorForNativePath(workspaceId: WorkspaceId, nativePath: string) {
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!workspace) throw new Error('invalid workspace pane workspace id')
  const root = formatWorkspaceLocator(
    workspace.transport === 'ssh'
      ? { transport: 'ssh', profile: workspace.profile, path: nativePath }
      : { transport: 'file', platform: workspace.platform, path: nativePath },
    workspace.transport === 'file' ? workspace.platform : 'posix',
  )
  if (!root) throw new Error('invalid workspace pane worktree path')
  return root
}

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
        handleSessionClosed(userId, session, reason)
      },
      onIdentity(userId, event) {
        broker.broadcastToUser(userId, { type: 'identity', event })
      },
      onLifecycle(userId, event) {
        broker.broadcastToUser(userId, { type: 'lifecycle', event })
      },
      onSessionsProjectionChanged(userId, repoRoot) {
        broadcastRepoSessionsChanged(userId, repoRoot)
      },
    },
    (userId, clientId) => broker.isClientOnline(userId, clientId),
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
    repoMembershipTtlMs: REPO_RUNTIME_MEMBERSHIP_TTL_MS,
  })
  broker = coordinator.broker
  sessionService = createTerminalSessionService({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalSessionId,
    manager,
    workspaceTabsCoordinator,
    isCurrentRepoRuntime: isCurrentRepoRuntime,
    broadcastSessionsChanged(userId, repoRoot) {
      broadcastRepoSessionsChanged(userId, repoRoot)
    },
    broadcastWorkspaceTabsChanged(userId, repoRoot) {
      broadcastRepoWorkspaceTabsChanged(userId, repoRoot)
    },
    gCommand: options.gCommand,
  })
  const invalidatedScopeRetirements = new Map<
    string,
    {
      userId: string
      repoRoot: string
      repoRuntimeId: string
      scope: string
      attempts: number
      running: boolean
      timer: ReturnType<typeof setTimeout> | null
    }
  >()
  const unsubscribeRepoRuntimeClosed = onRepoRuntimeClosed((event) => {
    const scope = terminalSessionRuntimeScope(event.repoRoot, event.repoRuntimeId)
    const invalidation = manager.commitRepoRuntimeSessionInvalidation(event.userId, scope)
    manager.releaseProjectionRevisionForScope(event.userId, scope)
    scheduleInvalidatedScopeRetirement({ ...event, scope })
    invalidation.publishEffects()
    try {
      broadcastRepoSessionsChanged(event.userId, event.repoRoot)
    } catch (error) {
      terminalRuntimeLogger.warn(
        { userId: event.userId, repoRoot: event.repoRoot, repoRuntimeId: event.repoRuntimeId, err: error },
        'failed to publish invalidated repo runtime sessions',
      )
    }
  })

  function scheduleInvalidatedScopeRetirement(input: {
    userId: string
    repoRoot: string
    repoRuntimeId: string
    scope: string
  }): void {
    if (shuttingDown) return
    const key = JSON.stringify([input.userId, input.scope])
    if (invalidatedScopeRetirements.has(key)) return
    const retirement = { ...input, attempts: 0, running: false, timer: null }
    invalidatedScopeRetirements.set(key, retirement)
    queueMicrotask(() => void runInvalidatedScopeRetirement(key, retirement))
  }

  async function runInvalidatedScopeRetirement(
    key: string,
    retirement: {
      userId: string
      repoRoot: string
      repoRuntimeId: string
      scope: string
      attempts: number
      running: boolean
      timer: ReturnType<typeof setTimeout> | null
    },
  ): Promise<void> {
    if (shuttingDown) {
      invalidatedScopeRetirements.delete(key)
      return
    }
    if (invalidatedScopeRetirements.get(key) !== retirement || retirement.running) return
    retirement.running = true
    retirement.timer = null
    try {
      await workspaceTabsCoordinator.closeInvalidatedScope({ userId: retirement.userId, scope: retirement.scope })
      if (invalidatedScopeRetirements.get(key) !== retirement) return
      invalidatedScopeRetirements.delete(key)
      try {
        broadcastRepoWorkspaceTabsChanged(retirement.userId, retirement.repoRoot)
      } catch (error) {
        terminalRuntimeLogger.warn(
          {
            userId: retirement.userId,
            repoRoot: retirement.repoRoot,
            repoRuntimeId: retirement.repoRuntimeId,
            err: error,
          },
          'failed to publish retired repo runtime workspace tabs',
        )
      }
    } catch (error) {
      retirement.attempts += 1
      terminalRuntimeLogger.warn(
        {
          userId: retirement.userId,
          repoRoot: retirement.repoRoot,
          repoRuntimeId: retirement.repoRuntimeId,
          attempt: retirement.attempts,
          err: error,
        },
        'failed to retire invalidated repo runtime workspace tabs; retrying',
      )
      if (invalidatedScopeRetirements.get(key) !== retirement) return
      if (shuttingDown) {
        invalidatedScopeRetirements.delete(key)
        return
      }
      const delay = Math.min(
        INVALIDATED_SCOPE_RETIREMENT_RETRY_BASE_MS * 2 ** Math.min(retirement.attempts - 1, 6),
        INVALIDATED_SCOPE_RETIREMENT_RETRY_MAX_MS,
      )
      retirement.timer = setTimeout(() => {
        retirement.timer = null
        void runInvalidatedScopeRetirement(key, retirement)
      }, delay)
      retirement.timer.unref?.()
    } finally {
      retirement.running = false
    }
  }

  let shuttingDown = false
  const actions = createTerminalRuntimeActions({
    manager,
    broker,
    sessionService,
    isValidTerminalClientId,
    worktreeOperations,
  })
  const terminalCreateProvider = createTerminalSessionCreateProvider({ sessionService, worktreeOperations })
  const workspacePaneRuntimeApplication = createWorkspacePaneRuntimeApplication({
    workspaceTabsCoordinator,
    worktreeOperations,
    physicalWorktrees,
    terminal: { ...terminalCreateProvider, close: actions.close },
    terminalWorktree: manager,
    isCurrentRepoRuntime,
    broadcastWorkspaceTabsChanged: broadcastRepoWorkspaceTabsRevision,
  })
  const worktreeRemovalApplication = createWorktreeRemovalApplication({
    worktreeOperations,
    physicalWorktrees,
    terminalWorktree: manager,
    workspaceTabs: workspaceTabsCoordinator,
    isCurrentRepoRuntime,
    broadcastSessionsChanged: broadcastRepoSessionsChanged,
    broadcastWorkspaceTabsChanged: broadcastRepoWorkspaceTabsChanged,
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
    isCurrentRepoRuntime: isCurrentRepoRuntime,
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
      const bufferStats = manager.getSessionBufferStats()
      return {
        terminal: {
          mode: ptySupervisor.getDiagnostics().mode,
          state: shuttingDown ? 'shutting-down' : 'running',
          registeredSockets: broker.socketCount(),
          shuttingDown,
          pty: ptySupervisor.getDiagnostics(),
          liveSessionCount: bufferStats.count,
          totalRingBufferChars: bufferStats.totalBufferChars,
          maxRingBufferChars: bufferStats.maxBufferChars,
        },
      }
    },
    terminalHandlers: realtimeHandlers,
    workspacePaneTabsHandlers: workspacePaneTabsRealtimeHandlers,
    workspacePaneRuntimeHandlers: workspacePaneRuntimeRealtimeHandlers,
    onShutdown() {
      if (shuttingDown) return
      shuttingDown = true
      unsubscribeRepoRuntimeClosed()
      for (const retirement of invalidatedScopeRetirements.values()) {
        if (retirement.timer) clearTimeout(retirement.timer)
      }
      invalidatedScopeRetirements.clear()
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
      scheduleInvalidatedScopeRetirement({
        userId,
        repoRoot: workspaceId,
        repoRuntimeId: workspaceRuntimeId,
        scope,
      })
      const terminalInvalidation = manager.commitGitSessionInvalidation(userId, scope)
      terminalInvalidation.publishEffects()
      if (durableLayoutChanged || terminalInvalidation.removedCount > 0) {
        try {
          broadcastRepoSessionsChanged(userId, workspaceId)
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

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', repoRoot })
  }

  function broadcastRepoWorkspaceTabsChanged(userId: string, repoRoot: string): void {
    broadcastWorkspacePaneTabsChanged(broker, userId, repoRoot)
  }

  function broadcastRepoWorkspaceTabsRevision(
    userId: string,
    repoRoot: string,
    workspaceRuntimeId: string,
    revision: number,
  ): void {
    broadcastWorkspacePaneTabsRevision(broker, userId, repoRoot, workspaceRuntimeId, revision)
  }

  function handleSessionClosed(
    userId: string,
    session: TerminalSessionSummary,
    reason: TerminalSessionCloseReason,
  ): void {
    if (reason !== 'session') return
    const { repoRoot } = terminalSessionCoordinates(session)
    broadcastRepoSessionsChanged(userId, repoRoot)
    void sessionService
      .reconcileTerminalTabsForSession(userId, session)
      .then(() => {
        broadcastRepoWorkspaceTabsChanged(userId, repoRoot)
      })
      .catch((err) => {
        terminalRuntimeLogger.warn(
          { userId, terminalRuntimeSessionId: session.terminalRuntimeSessionId, repoRoot, err },
          'failed to reconcile workspace tabs after terminal session close',
        )
      })
  }
}

async function clearWorkspacePaneDurableLayout(
  repository: WorkspacePaneLayoutRepository,
  workspaceId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await repository.load(workspaceId)
    const replacement = {
      entries: current.layout.entries.filter((entry) => entry.target.kind === 'workspace-root'),
    }
    if (workspacePaneDurableLayoutsEqual(workspaceId, current.layout, replacement)) return false
    const outcome = await repository.compareAndSwap({
      repoRoot: workspaceId,
      expected: current.layout,
      replacement,
    })
    if (outcome.kind === 'accepted') return outcome.changed
    if (outcome.kind === 'write-failure') throw outcome.error
  }
  throw new Error('workspace pane layout cleanup was superseded')
}
