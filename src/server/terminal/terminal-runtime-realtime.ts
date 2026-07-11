import type {
  AppRealtimeOutputFlushBoundary,
  AppRealtimeOutputFlushBoundaryContext,
  BufferedAppRealtimeSocket,
} from '#/server/realtime/buffered-app-realtime-socket.ts'
import type {
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type { ServerTerminalActionHost } from '#/server/terminal/terminal-host.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'

type MaybePromise<T> = T | Promise<T>

// Action → handler table. The handler receives the union-shaped input
// and the WS request's `clientId`/`userId`. `clientId` is folded into
// actions that attach a terminal controller; `userId` is threaded through to
// the host unchanged. Runtime tab creation intentionally lives on the
// workspace-pane application command surface. See `identity.ts` for the
// routing-vs-identity distinction.
export function createTerminalRealtimeHandlers(host: ServerTerminalActionHost): {
  [TAction in TerminalSocketRequestAction]: (
    clientId: string,
    userId: string,
    input: TerminalSocketRequestInputs[TAction],
  ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
} {
  return {
    attach(clientId, userId, input) {
      return host.attach(clientId, userId, { ...input, clientId })
    },
    restart(clientId, userId, input) {
      return host.restart(clientId, userId, { ...input, clientId })
    },
    write(clientId, userId, input) {
      return host.write(clientId, userId, { ...input, clientId })
    },
    resize(clientId, userId, input) {
      return host.resize(clientId, userId, { ...input, clientId })
    },
    takeover(clientId, userId, input) {
      return host.takeover(clientId, userId, { ...input, clientId })
    },
    close(clientId, userId, input) {
      return host.close(clientId, userId, input)
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
  handlers: {
    [TAction in TerminalSocketRequestAction]: (
      clientId: string,
      userId: string,
      input: TerminalSocketRequestInputs[TAction],
    ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
  },
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  bufferedSocket: BufferedAppRealtimeSocket | undefined,
  message: TerminalSocketRequestMessage,
): Promise<void> {
  let response: TerminalSocketResponseMessage
  try {
    const handler = handlers[message.action] as (
      clientId: string,
      userId: string,
      input: TerminalSocketRequestInputs[typeof message.action],
    ) => MaybePromise<TerminalSocketResponseOutputs[typeof message.action]>
    const payload = await handler(clientId, userId, message.input)
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
  if (!sendRealtimeResponse(socket, response)) {
    bufferedSocket?.deactivate()
  }
  if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.resume(outputFlushBoundaryFromResponse(response))
}

function sendRealtimeResponse(socket: RealtimeSocket, message: TerminalSocketResponseMessage): boolean {
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

// Pause the buffered socket while an action's response is being prepared
// when the action's response carries the authoritative frame transition
// for a terminal view. Without this, live realtime messages that arrive
// during the request can race ahead of the authoritative response and
// split the client's transition across two sources.
//
// `attach` and `restart` both return snapshot hydration
// data that the client applies as one boundary.
// `takeover` does not return a fresh snapshot, but its response is still
// the authoritative identity/geometry handshake for the new controller;
// the same socket must not observe the identity event before that
// response settles.
export function shouldPauseRealtimeRequest(action: TerminalSocketRequestAction): boolean {
  return action === 'attach' || action === 'restart' || action === 'takeover' || action === 'recover-sessions'
}

function outputFlushBoundaryFromResponse(
  message: TerminalSocketResponseMessage,
): AppRealtimeOutputFlushBoundaryContext | null {
  if (!message.ok) return null
  if (message.action === 'recover-sessions') {
    return message.payload.snapshots.map((snapshot) => ({
      terminalRuntimeSessionId: snapshot.terminalRuntimeSessionId,
      terminalRuntimeGeneration: snapshot.terminalRuntimeGeneration,
      outputEra: snapshot.outputEra,
      seq: snapshot.snapshotSeq,
    }))
  }
  if (message.action !== 'attach' && message.action !== 'restart') return null
  const payload = message.payload
  if (!payload.ok) return null
  return {
    terminalRuntimeSessionId: payload.terminalRuntimeSessionId,
    terminalRuntimeGeneration: payload.terminalRuntimeGeneration,
    outputEra: payload.outputEra,
    seq: payload.snapshotSeq,
  }
}
