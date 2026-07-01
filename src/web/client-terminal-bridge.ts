import { normalizeTerminalSessionSummaryList, normalizeWorkspacePaneTabsEntryList } from '#/shared/terminal-validators.ts'
import { resolveTerminalController } from '#/shared/terminal-controller.ts'
import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'
import type {
  TerminalBellRealtimeEvent,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalTestNotificationInput,
  TerminalTitleEvent,
} from '#/shared/terminal-types.ts'
import type { ClientTerminalBridge } from '#/web/client-bridge-types.ts'
import type { TerminalIdentityViewModel, TerminalLifecycleViewModel } from '#/web/components/terminal/types.ts'
import {
  createTerminalSocketConnection,
  type TerminalSocketServerConfig,
} from '#/web/client-terminal-socket-connection.ts'
import type { TerminalNotificationProvider } from '#/web/terminal-notification-provider.ts'

export type ClientServerTerminalConfig = TerminalSocketServerConfig

export function createServerTerminalBridge(options: {
  getServerConfig: () => ClientServerTerminalConfig
  notificationProvider: TerminalNotificationProvider
  setBadge?: (count: number) => void
}): ClientTerminalBridge {
  const outputSubscribers = new Set<(event: TerminalOutputEvent) => void>()
  const bellSubscribers = new Set<(event: TerminalBellRealtimeEvent) => void>()
  const titleSubscribers = new Set<(event: TerminalTitleEvent) => void>()
  const exitSubscribers = new Set<(event: TerminalExitEvent) => void>()
  const identitySubscribers = new Set<(event: TerminalIdentityViewModel) => void>()
  const lifecycleSubscribers = new Set<(event: TerminalLifecycleViewModel) => void>()
  const sessionsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const workspaceTabsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const sessionClosedSubscribers = new Set<
    (event: { ptySessionId: string; terminalSessionId: string; repoRoot: string; worktreePath: string }) => void
  >()

  const connection = createTerminalSocketConnection({
    getServerConfig: options.getServerConfig,
    hasRealtimeSubscribers,
    onRealtimeMessage: handleRealtimeMessage,
  })

  return {
    attach(input) {
      return connection.request('attach', input)
    },
    restart(input) {
      return connection.request('restart', input)
    },
    write(input) {
      return connection.request('write', input)
    },
    resize(input) {
      return connection.request('resize', input)
    },
    takeover(input) {
      return connection.request('takeover', input)
    },
    close(input) {
      return connection.request('close', input)
    },
    create(input) {
      return connection.request('create', input satisfies TerminalCreateInput)
    },
    replaceWorkspaceTabs(input) {
      return connection.request('replace-tabs', input)
    },
    updateWorkspaceTabs(input) {
      return connection.request('update-tabs', input)
    },
    pruneTerminals(repoRoot) {
      return connection.request('prune', { repoRoot })
    },
    listSessions(input) {
      return connection.request('list-sessions', input).then((value) => {
        const sessions = normalizeTerminalSessionSummaryList(value)
        if (!sessions) throw new Error('Terminal socket response failed: invalid terminal sessions response')
        return sessions
      })
    },
    listWorkspaceTabs(input) {
      return connection.request('list-workspace-tabs', input).then((value) => {
        const tabs = normalizeWorkspacePaneTabsEntryList(value)
        if (!tabs) throw new Error('Terminal socket response failed: invalid workspace tabs response')
        return tabs
      })
    },
    prewarm() {
      return connection.prewarm()
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
      connection.openForRealtime()
      return () => {
        outputSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onBell(cb) {
      bellSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        bellSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onTitle(cb) {
      titleSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        titleSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onExit(cb) {
      exitSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        exitSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onIdentity(cb) {
      identitySubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        identitySubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onLifecycle(cb) {
      lifecycleSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        lifecycleSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onSessionsChanged(cb) {
      sessionsChangedSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        sessionsChangedSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onWorkspaceTabsChanged(cb) {
      workspaceTabsChangedSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        workspaceTabsChangedSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onSessionClosed(cb) {
      sessionClosedSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        sessionClosedSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    kickReconnect() {
      connection.kickReconnect()
    },
  }

  function hasRealtimeSubscribers(): boolean {
    return (
      outputSubscribers.size > 0 ||
      bellSubscribers.size > 0 ||
      titleSubscribers.size > 0 ||
      exitSubscribers.size > 0 ||
      identitySubscribers.size > 0 ||
      lifecycleSubscribers.size > 0 ||
      sessionsChangedSubscribers.size > 0 ||
      workspaceTabsChangedSubscribers.size > 0 ||
      sessionClosedSubscribers.size > 0
    )
  }

  function handleRealtimeMessage(message: TerminalRealtimeMessage, currentClientId: string): void {
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
      case 'workspace-tabs-changed':
        for (const subscriber of workspaceTabsChangedSubscribers) subscriber(message.repoRoot)
        return
      case 'session-closed':
        for (const subscriber of sessionClosedSubscribers)
          subscriber({
            ptySessionId: message.ptySessionId,
            terminalSessionId: message.terminalSessionId,
            repoRoot: message.repoRoot,
            worktreePath: message.worktreePath,
          })
        return
      case 'identity': {
        const identityEvent = {
          ptySessionId: message.event.ptySessionId,
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
    }
  }
}
