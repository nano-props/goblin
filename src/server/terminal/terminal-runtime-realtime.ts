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
// and the WS request's `clientId`/`attachmentId`/`ownerId`. The
// first two are merged into the input (e.g. `create` needs the
// `attachmentId` it didn't ask the client to provide); `ownerId`
// is threaded through to the host unchanged. See `identity.ts` for
// the routing-vs-identity distinction.
export function createTerminalRealtimeHandlers(host: ServerTerminalHost): {
  [TAction in TerminalSocketRequestAction]: (
    clientId: string,
    attachmentId: string,
    ownerId: string,
    input: TerminalSocketRequestInputs[TAction],
  ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
} {
  return {
    attach(clientId, attachmentId, ownerId, input) {
      return host.attach(clientId, ownerId, { ...input, attachmentId })
    },
    restart(clientId, attachmentId, ownerId, input) {
      return host.restart(clientId, ownerId, { ...input, attachmentId })
    },
    write(clientId, attachmentId, ownerId, input) {
      return host.write(clientId, ownerId, { ...input, attachmentId })
    },
    resize(clientId, attachmentId, ownerId, input) {
      return host.resize(clientId, ownerId, { ...input, attachmentId })
    },
    takeover(clientId, attachmentId, ownerId, input) {
      return host.takeover(clientId, ownerId, { ...input, attachmentId })
    },
    close(clientId, _attachmentId, ownerId, input) {
      return host.close(clientId, ownerId, input)
    },
    'list-sessions'(clientId, _attachmentId, ownerId, input) {
      return host.listSessions(clientId, ownerId, input.repoRoot)
    },
    create(clientId, attachmentId, ownerId, input) {
      return host.create(clientId, ownerId, { ...input, attachmentId })
    },
    prune(clientId, _attachmentId, ownerId, input) {
      return host.prune(clientId, ownerId, input.repoRoot)
    },
    'session-snapshot'(clientId, _attachmentId, ownerId, input) {
      return host.getSessionSnapshot(clientId, ownerId, input)
    },
    reorder(clientId, _attachmentId, ownerId, input) {
      return host.reorder(clientId, ownerId, input)
    },
  }
}

export async function handleTerminalRealtimeRequestMessage(
  handlers: {
    [TAction in TerminalSocketRequestAction]: (
      clientId: string,
      attachmentId: string,
      ownerId: string,
      input: TerminalSocketRequestInputs[TAction],
    ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
  },
  clientId: string,
  attachmentId: string,
  ownerId: string,
  socket: TerminalRealtimeSocket,
  bufferedSocket: BufferedTerminalSocket | undefined,
  message: TerminalClientMessage,
): Promise<void> {
  let response: TerminalSocketResponseMessage
  try {
    const handler = handlers[message.action] as (
      clientId: string,
      attachmentId: string,
      ownerId: string,
      input: TerminalSocketRequestInputs[typeof message.action],
    ) => MaybePromise<TerminalSocketResponseOutputs[typeof message.action]>
    const payload = await handler(clientId, attachmentId, ownerId, message.input)
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
