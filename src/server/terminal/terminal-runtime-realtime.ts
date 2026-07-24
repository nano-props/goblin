import type {
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type { TerminalOutputCheckpoint } from '#/shared/terminal-types.ts'
import type { ServerTerminalActionHost } from '#/server/terminal/terminal-host.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import { invokeRealtimeRpcHandler, type RealtimeRpcHandlers } from '#/server/realtime/realtime-rpc-handlers.ts'

// Action → handler table. The handler receives the union-shaped input
// and the WS request's `clientId`/`userId`. `clientId` is folded into
// actions that attach a terminal controller; `userId` is threaded through to
// the host unchanged. Runtime tab creation intentionally lives on the
// workspace-pane application command surface. See `identity.ts` for the
// routing-vs-identity distinction.
export function createTerminalRealtimeHandlers(
  host: ServerTerminalActionHost,
): RealtimeRpcHandlers<TerminalSocketRequestInputs, TerminalSocketResponseOutputs> {
  return {
    attach(clientId, userId, input) {
      return host.attach(clientId, userId, input)
    },
    restart(clientId, userId, input) {
      return host.restart(clientId, userId, input)
    },
    write(clientId, userId, input) {
      return host.write(clientId, userId, input)
    },
    resize(clientId, userId, input) {
      return host.resize(clientId, userId, input)
    },
    takeover(clientId, userId, input) {
      return host.takeover(clientId, userId, input)
    },
    'recover-sessions'(clientId, userId, input) {
      return host.recoverSessions(clientId, userId, input)
    },
    prune(clientId, userId, input) {
      return host.prune(clientId, userId, input)
    },
  }
}

export async function handleTerminalRealtimeRequestMessage(
  handlers: RealtimeRpcHandlers<TerminalSocketRequestInputs, TerminalSocketResponseOutputs>,
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  message: TerminalSocketRequestMessage,
): Promise<TerminalOutputCheckpoint | null> {
  let response: TerminalSocketResponseMessage
  try {
    const payload = await invokeRealtimeRpcHandler(handlers, clientId, userId, message.action, message.input)
    response = {
      type: 'response',
      requestId: message.requestId,
      ok: true,
      action: message.action,
      payload,
    } as TerminalSocketResponseMessage
  } catch (error) {
    response = {
      type: 'response',
      requestId: message.requestId,
      ok: false,
      action: message.action,
      error: error instanceof Error ? error.message : String(error),
    } as TerminalSocketResponseMessage
  }
  socket.send(JSON.stringify(response))
  return outputFlushBoundaryFromResponse(response)
}

// These responses establish an authoritative frame transition for a terminal
// view. The socket serializes them and keeps realtime effects behind the
// response so the client never observes one transition from two sources.
//
// Existing-session recovery attach returns snapshot hydration. Fresh attach
// and restart both establish a new PTY generation and return a stream
// handshake: ordering still keeps the response first, but its null flush
// boundary deliberately drops nothing so sequence 1 reaches the fitted xterm.
// `takeover` does not return a fresh snapshot, but its response is still
// the authoritative identity/geometry handshake for the new controller;
// the same socket must not observe the identity event before that
// response settles.
export function requiresRealtimeOrdering(action: TerminalSocketRequestAction): boolean {
  return action === 'attach' || action === 'restart' || action === 'takeover'
}

function outputFlushBoundaryFromResponse(message: TerminalSocketResponseMessage): TerminalOutputCheckpoint | null {
  if (!message.ok) return null
  if (message.action !== 'attach' && message.action !== 'restart') return null
  const payload = message.payload
  if (!payload.ok) return null
  if (payload.frame === 'stream') return null
  return {
    terminalRuntimeSessionId: payload.terminalRuntimeSessionId,
    terminalRuntimeGeneration: payload.terminalRuntimeGeneration,
    seq: payload.snapshotSeq,
  }
}
