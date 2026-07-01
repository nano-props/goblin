import { BufferedTerminalSocket } from '#/server/terminal/buffered-terminal-socket.ts'
import type {
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'

type MaybePromise<T> = T | Promise<T>

// Action → handler table. The handler receives the union-shaped input
// and the WS request's `clientId`/`userId`. `clientId` is folded
// into the input for actions that need it (e.g. `create` needs the
// `clientId` it didn't ask the client to provide); `userId` is
// threaded through to the host unchanged. See `identity.ts` for
// the routing-vs-identity distinction.
export function createTerminalRealtimeHandlers(host: ServerTerminalHost): {
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
    'list-sessions'(clientId, userId, input) {
      return host.listSessions(clientId, userId, input.repoRoot)
    },
    'list-workspace-tabs'(clientId, userId, input) {
      return host.listWorkspaceTabs(clientId, userId, input.repoRoot)
    },
    create(clientId, userId, input) {
      return host.create(clientId, userId, { ...input, clientId })
    },
    'replace-tabs'(clientId, userId, input) {
      return host.replaceTabs(clientId, userId, input)
    },
    'update-tabs'(clientId, userId, input) {
      return host.updateTabs(clientId, userId, input)
    },
    prune(clientId, userId, input) {
      return host.prune(clientId, userId, input.repoRoot)
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
  socket: TerminalRealtimeSocket,
  bufferedSocket: BufferedTerminalSocket | undefined,
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
// when the action's response carries the authoritative frame transition
// for a terminal view. Without this, live realtime messages that arrive
// during the request can race ahead of the authoritative response and
// split the client's transition across two sources.
//
// `attach`, `restart`, and `create` all return snapshot hydration
// data that the client applies as one boundary.
// `takeover` does not return a fresh snapshot, but its response is still
// the authoritative identity/geometry handshake for the new controller;
// the same socket must not observe the identity event before that
// response settles.
export function shouldPauseRealtimeRequest(action: TerminalSocketRequestAction): boolean {
  return action === 'attach' || action === 'restart' || action === 'create' || action === 'takeover'
}
