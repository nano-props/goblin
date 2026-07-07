import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientTerminal } from '#/web/client-bridge-types.ts'

function getTerminalClient(): ClientTerminal {
  return getClientBridge().terminal()
}

export const terminalClient: ClientTerminal = {
  attach(input) {
    return getTerminalClient().attach(input)
  },
  restart(input) {
    return getTerminalClient().restart(input)
  },
  write(input) {
    return getTerminalClient().write(input)
  },
  resize(input) {
    return getTerminalClient().resize(input)
  },
  takeover(input) {
    return getTerminalClient().takeover(input)
  },
  close(input) {
    return getTerminalClient().close(input)
  },
  create(input) {
    return getTerminalClient().create(input)
  },
  pruneTerminals(repoRoot, repoInstanceId) {
    return getTerminalClient().pruneTerminals(repoRoot, repoInstanceId)
  },
  listSessions(input) {
    return getTerminalClient().listSessions(input)
  },
  recoverSessions(input) {
    return getTerminalClient().recoverSessions(input)
  },
  notifyBell(input) {
    return getTerminalClient().notifyBell(input)
  },
  sendTestNotification(input) {
    return getTerminalClient().sendTestNotification(input)
  },
  setBadge(count) {
    getTerminalClient().setBadge(count)
  },
  onOutput(cb) {
    return getTerminalClient().onOutput(cb)
  },
  onBell(cb) {
    return getTerminalClient().onBell(cb)
  },
  onTitle(cb) {
    return getTerminalClient().onTitle(cb)
  },
  onExit(cb) {
    return getTerminalClient().onExit(cb)
  },
  onIdentity(cb) {
    return getTerminalClient().onIdentity(cb)
  },
  onLifecycle(cb) {
    return getTerminalClient().onLifecycle(cb)
  },
  onSessionsChanged(cb) {
    return getTerminalClient().onSessionsChanged(cb)
  },
  onSessionClosed(cb) {
    return getTerminalClient().onSessionClosed(cb)
  },
}
