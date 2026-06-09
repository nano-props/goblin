import {
  attachServerTerminal,
  closeAllServerTerminalSessions,
  closeServerTerminal,
  createServerTerminal,
  getServerTerminalSessionSnapshot,
  listServerTerminalSessions,
  notifyServerTerminalBell,
  pruneServerTerminals,
  registerTerminalSocket,
  restartServerTerminal,
  resizeServerTerminal,
  takeoverServerTerminal,
  unregisterTerminalSocket,
  writeServerTerminal,
} from '#/server/terminal/terminal.ts'
import type { ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'
import type { TerminalWorkerRequestInputs, TerminalWorkerResponseOutputs } from '#/server/terminal/terminal-worker-protocol.ts'

type MaybePromise<T> = T | Promise<T>

export interface TerminalFacade {
  registerSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  unregisterSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  attach(clientId: string, input: TerminalWorkerRequestInputs['attach']): MaybePromise<TerminalWorkerResponseOutputs['attach']>
  restart(clientId: string, input: TerminalWorkerRequestInputs['restart']): MaybePromise<TerminalWorkerResponseOutputs['restart']>
  write(clientId: string, input: TerminalWorkerRequestInputs['write']): MaybePromise<TerminalWorkerResponseOutputs['write']>
  resize(clientId: string, input: TerminalWorkerRequestInputs['resize']): MaybePromise<TerminalWorkerResponseOutputs['resize']>
  takeover(clientId: string, input: TerminalWorkerRequestInputs['takeover']): MaybePromise<TerminalWorkerResponseOutputs['takeover']>
  close(clientId: string, input: TerminalWorkerRequestInputs['close']): MaybePromise<TerminalWorkerResponseOutputs['close']>
  notifyBell(
    clientId: string,
    input: TerminalWorkerRequestInputs['notify-bell'],
  ): MaybePromise<TerminalWorkerResponseOutputs['notify-bell']>
  listSessions(
    clientId: string,
    input: TerminalWorkerRequestInputs['list-sessions'],
  ): MaybePromise<TerminalWorkerResponseOutputs['list-sessions']>
  create(clientId: string, input: TerminalWorkerRequestInputs['create']): MaybePromise<TerminalWorkerResponseOutputs['create']>
  prune(clientId: string, input: TerminalWorkerRequestInputs['prune']): MaybePromise<TerminalWorkerResponseOutputs['prune']>
  getSessionSnapshot(
    clientId: string,
    input: TerminalWorkerRequestInputs['session-snapshot'],
  ): MaybePromise<TerminalWorkerResponseOutputs['session-snapshot']>
  shutdown(): void
}

export function createTerminalFacade(): TerminalFacade {
  return {
    registerSocket: registerTerminalSocket,
    unregisterSocket: unregisterTerminalSocket,
    attach: attachServerTerminal,
    restart: restartServerTerminal,
    write: writeServerTerminal,
    resize: resizeServerTerminal,
    takeover: takeoverServerTerminal,
    close: closeServerTerminal,
    notifyBell: notifyServerTerminalBell,
    listSessions(clientId, input) {
      return listServerTerminalSessions(clientId, input.repoRoot)
    },
    create: createServerTerminal,
    prune(clientId, input) {
      return pruneServerTerminals(clientId, input.repoRoot)
    },
    getSessionSnapshot: getServerTerminalSessionSnapshot,
    shutdown: closeAllServerTerminalSessions,
  }
}
