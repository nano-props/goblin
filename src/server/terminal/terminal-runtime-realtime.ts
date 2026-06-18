import { BufferedTerminalSocket } from '#/server/terminal/buffered-terminal-socket.ts'
import type {
  TerminalClientMessage,
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketResponseMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'

type MaybePromise<T> = T | Promise<T>

// Action → handler table. The handler receives the union-shaped input
// and the WS request's `clientId`/`attachmentId` (the latter is used
// by handlers that need to merge it into the input — see `create`).
export function createTerminalRealtimeHandlers(host: ServerTerminalHost): {
  [TAction in TerminalSocketRequestAction]: (
    clientId: string,
    attachmentId: string,
    input: TerminalSocketRequestInputs[TAction],
  ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
} {
  return {
    attach(clientId, attachmentId, input) {
      return host.attach(clientId, { ...input, attachmentId })
    },
    restart(clientId, attachmentId, input) {
      return host.restart(clientId, { ...input, attachmentId })
    },
    write(clientId, attachmentId, input) {
      return host.write(clientId, { ...input, attachmentId })
    },
    resize(clientId, attachmentId, input) {
      return host.resize(clientId, { ...input, attachmentId })
    },
    takeover(clientId, attachmentId, input) {
      return host.takeover(clientId, { ...input, attachmentId })
    },
    close(clientId, _attachmentId, input) {
      return host.close(clientId, input)
    },
    'list-sessions'(clientId, _attachmentId, input) {
      return host.listSessions(clientId, input.repoRoot)
    },
    create(clientId, attachmentId, input) {
      return host.create(clientId, { ...input, attachmentId })
    },
    prune(clientId, _attachmentId, input) {
      return host.prune(clientId, input.repoRoot)
    },
    'session-snapshot'(clientId, _attachmentId, input) {
      return host.getSessionSnapshot(clientId, input)
    },
    reorder(clientId, _attachmentId, input) {
      return host.reorder(clientId, input)
    },
  }
}

export async function handleTerminalRealtimeRequestMessage(
  handlers: {
    [TAction in TerminalSocketRequestAction]: (
      clientId: string,
      attachmentId: string,
      input: TerminalSocketRequestInputs[TAction],
    ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
  },
  clientId: string,
  attachmentId: string,
  socket: TerminalRealtimeSocket,
  bufferedSocket: BufferedTerminalSocket | undefined,
  message: TerminalClientMessage,
): Promise<void> {
  let response: TerminalSocketResponseMessage
  try {
    const handler = handlers[message.action] as (
      clientId: string,
      attachmentId: string,
      input: TerminalSocketRequestInputs[typeof message.action],
    ) => MaybePromise<TerminalSocketResponseOutputs[typeof message.action]>
    const payload = await handler(clientId, attachmentId, message.input)
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
  if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.resume()
}

function sendRealtimeResponse(socket: TerminalRealtimeSocket, message: TerminalSocketResponseMessage): boolean {
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

// Pause the buffered socket while an action's response is being prepared
// when the action's response carries the authoritative first frame for
// a terminal view. Without this, live `output` events that arrive during
// the request can race ahead of the snapshot-bearing response and split
// the initial prompt across replay and realtime delivery.
//
// `attach`, `restart`, and now `create` all return snapshot hydration
// data that the renderer applies as one boundary. `session-snapshot`
// still remains excluded because that payload is consumed as a later
// reconciliation path rather than the primary first-frame handshake.
export function shouldPauseRealtimeRequest(action: TerminalSocketRequestAction): boolean {
  return action === 'attach' || action === 'restart' || action === 'create'
}
