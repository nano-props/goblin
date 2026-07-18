import { normalizeTerminalSessionsSnapshot } from '#/shared/terminal-validators.ts'
import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import type {
  TerminalBellRealtimeEvent,
  TerminalExitEvent,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalTestNotificationInput,
  TerminalTitleEvent,
} from '#/shared/terminal-types.ts'
import type { ClientTerminal } from '#/web/client-bridge-types.ts'
import type { TerminalIdentityRealtimeEvent, TerminalLifecycleRealtimeEvent } from '#/web/components/terminal/types.ts'
import type { ClientAppRealtime, AppRealtimeServerConfig } from '#/web/app-realtime-client.ts'
import type { TerminalNotificationProvider } from '#/web/terminal-notification-provider.ts'

export type ClientServerTerminalConfig = AppRealtimeServerConfig

export function createServerTerminalClient(options: {
  realtime: ClientAppRealtime
  notificationProvider: TerminalNotificationProvider
  setBadge?: (count: number) => void
}): ClientTerminal {
  const outputSubscribers = new Set<(event: TerminalOutputEvent) => void>()
  const bellSubscribers = new Set<(event: TerminalBellRealtimeEvent) => void>()
  const titleSubscribers = new Set<(event: TerminalTitleEvent) => void>()
  const exitSubscribers = new Set<(event: TerminalExitEvent) => void>()
  const identitySubscribers = new Set<(event: TerminalIdentityRealtimeEvent) => void>()
  const lifecycleSubscribers = new Set<(event: TerminalLifecycleRealtimeEvent) => void>()
  const sessionsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const sessionClosedSubscribers = new Set<
    (event: {
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: number
      terminalSessionId: string
      repoRoot: string
    }) => void
  >()

  let realtimeUnsubscribe: (() => void) | null = null

  const terminal: ClientTerminal = {
    attach(input) {
      return options.realtime.request('attach', input)
    },
    restart(input) {
      return options.realtime.request('restart', input)
    },
    write(input) {
      return options.realtime.request('write', input)
    },
    resize(input) {
      return options.realtime.request('resize', input)
    },
    takeover(input) {
      return options.realtime.request('takeover', input)
    },
    pruneTerminals(repoRoot, repoRuntimeId) {
      return options.realtime.request('prune', { repoRoot, repoRuntimeId })
    },
    recoverSessions(input) {
      return options.realtime.request('recover-sessions', input).then((value) => {
        const catalog = normalizeTerminalSessionsSnapshot(value)
        if (!catalog) throw new Error('Terminal socket response failed: invalid terminal catalog response')
        return catalog
      })
    },
    notifyBell(input: TerminalNotifyBellInput) {
      return options.notificationProvider.notifyBell(input)
    },
    sendTestNotification(input: TerminalTestNotificationInput) {
      return options.notificationProvider.sendTestNotification(input)
    },
    setBadge(count) {
      options.setBadge?.(count)
    },
    onOutput(cb) {
      outputSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        outputSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onBell(cb) {
      bellSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        bellSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onTitle(cb) {
      titleSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        titleSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onExit(cb) {
      exitSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        exitSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onIdentity(cb) {
      identitySubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        identitySubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onLifecycle(cb) {
      lifecycleSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        lifecycleSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onSessionsChanged(cb) {
      sessionsChangedSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        sessionsChangedSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
    onSessionClosed(cb) {
      sessionClosedSubscribers.add(cb)
      ensureRealtimeSubscription()
      return () => {
        sessionClosedSubscribers.delete(cb)
        closeRealtimeSubscriptionIfIdle()
      }
    },
  }

  return terminal

  function hasRealtimeSubscribers(): boolean {
    return (
      outputSubscribers.size > 0 ||
      bellSubscribers.size > 0 ||
      titleSubscribers.size > 0 ||
      exitSubscribers.size > 0 ||
      identitySubscribers.size > 0 ||
      lifecycleSubscribers.size > 0 ||
      sessionsChangedSubscribers.size > 0 ||
      sessionClosedSubscribers.size > 0
    )
  }

  function ensureRealtimeSubscription(): void {
    if (realtimeUnsubscribe) return
    realtimeUnsubscribe = options.realtime.onMessage(handleRealtimeMessage)
  }

  function closeRealtimeSubscriptionIfIdle(): void {
    if (hasRealtimeSubscribers() || !realtimeUnsubscribe) return
    realtimeUnsubscribe()
    realtimeUnsubscribe = null
  }

  function handleRealtimeMessage(message: AppRealtimeMessage, currentClientId: string): void {
    switch (message.type) {
      case 'output':
        for (const subscriber of outputSubscribers) subscriber(message.event)
        return
      case 'bell':
        for (const subscriber of bellSubscribers) subscriber(message.event)
        return
      case 'title':
        for (const subscriber of titleSubscribers) subscriber(message.event)
        return
      case 'exit':
        for (const subscriber of exitSubscribers) subscriber(message.event)
        return
      case 'sessions-changed':
        for (const subscriber of sessionsChangedSubscribers) subscriber(message.repoRoot)
        return
      case 'session-closed':
        for (const subscriber of sessionClosedSubscribers)
          subscriber({
            terminalRuntimeSessionId: message.terminalRuntimeSessionId,
            terminalRuntimeGeneration: message.terminalRuntimeGeneration,
            terminalSessionId: message.terminalSessionId,
            repoRoot: message.repoRoot,
          })
        return
      case 'identity': {
        const identityEvent = {
          terminalRuntimeSessionId: message.event.terminalRuntimeSessionId,
          terminalRuntimeGeneration: message.event.terminalRuntimeGeneration,
          terminalSessionId: message.event.terminalSessionId,
          ...resolveTerminalController(message.event.controller, currentClientId),
          canonicalCols: message.event.canonicalCols,
          canonicalRows: message.event.canonicalRows,
        }
        for (const subscriber of identitySubscribers) subscriber(identityEvent)
        return
      }
      case 'lifecycle':
        for (const subscriber of lifecycleSubscribers) subscriber(message.event)
        return
      default:
        return
    }
  }
}
