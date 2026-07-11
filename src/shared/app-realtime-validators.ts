import * as v from 'valibot'
import type {
  AppRealtimeClientMessage,
  AppRealtimeRequestAction,
  AppRealtimeSocketServerMessage,
} from '#/shared/app-realtime-socket.ts'
import { normalizeTerminalClientMessage, normalizeTerminalSocketServerMessage } from '#/shared/terminal-validators.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
  type WorkspacePaneTabsSocketAction,
} from '#/shared/workspace-pane-tabs.ts'
import {
  WorkspacePaneTabsListInputSchema,
  WorkspacePaneTabsReplaceInputSchema,
  WorkspacePaneTabsSnapshotSchema,
  WorkspacePaneTabsUpdateInputSchema,
} from '#/shared/workspace-pane-tabs-validators.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeSocketAction,
} from '#/shared/workspace-pane-runtime.ts'
import {
  normalizeWorkspacePaneRuntimeCloseResult,
  normalizeWorkspacePaneRuntimeOpenResult,
  WorkspacePaneRuntimeCloseInputSchema,
  WorkspacePaneRuntimeOpenInputSchema,
} from '#/shared/workspace-pane-runtime-validators.ts'

const APP_REALTIME_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const APP_REALTIME_INVALID_RESPONSE_PAYLOAD_ERROR = 'Invalid realtime socket response payload'
export const APP_REALTIME_WS_MESSAGE_LIMIT_BYTES = 1024 * 1024

const AppRealtimeRequestIdSchema = v.pipe(v.string(), v.regex(APP_REALTIME_REQUEST_ID_RE))
const WorkspacePaneTabsSocketActionSchema = v.picklist([
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
] as const)
const WorkspacePaneRuntimeSocketActionSchema = v.picklist([
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
] as const)

const AppRealtimeNonTerminalClientMessageSchema = v.variant('type', [
  v.object({
    type: v.literal('request'),
    requestId: AppRealtimeRequestIdSchema,
    action: v.literal(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list),
    input: WorkspacePaneTabsListInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: AppRealtimeRequestIdSchema,
    action: v.literal(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace),
    input: WorkspacePaneTabsReplaceInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: AppRealtimeRequestIdSchema,
    action: v.literal(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update),
    input: WorkspacePaneTabsUpdateInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: AppRealtimeRequestIdSchema,
    action: v.literal(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open),
    input: WorkspacePaneRuntimeOpenInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: AppRealtimeRequestIdSchema,
    action: v.literal(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close),
    input: WorkspacePaneRuntimeCloseInputSchema,
  }),
  v.object({
    type: v.literal('heartbeat'),
  }),
  v.object({
    type: v.literal('ping'),
    requestId: AppRealtimeRequestIdSchema,
  }),
])

const AppRealtimeNonTerminalServerMessageSchema = v.variant('type', [
  v.object({ type: v.literal(WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed), repoRoot: v.string() }),
  v.object({
    type: v.literal('response'),
    requestId: AppRealtimeRequestIdSchema,
    ok: v.literal(true),
    action: v.union([WorkspacePaneTabsSocketActionSchema, WorkspacePaneRuntimeSocketActionSchema]),
    payload: v.unknown(),
  }),
  v.object({
    type: v.literal('response'),
    requestId: AppRealtimeRequestIdSchema,
    ok: v.literal(false),
    action: v.union([WorkspacePaneTabsSocketActionSchema, WorkspacePaneRuntimeSocketActionSchema]),
    error: v.string(),
  }),
  v.object({
    type: v.literal('pong'),
    requestId: AppRealtimeRequestIdSchema,
  }),
])

export function normalizeAppRealtimeClientMessage(value: unknown): AppRealtimeClientMessage | null {
  const terminal = normalizeTerminalClientMessage(value)
  if (terminal) return terminal
  const parsed = v.safeParse(AppRealtimeNonTerminalClientMessageSchema, value)
  return parsed.success ? (parsed.output as AppRealtimeClientMessage) : null
}

export function normalizeAppRealtimeSocketServerMessage(value: unknown): AppRealtimeSocketServerMessage | null {
  const terminal = normalizeTerminalSocketServerMessage(value)
  if (terminal) return terminal
  const parsed = v.safeParse(AppRealtimeNonTerminalServerMessageSchema, value)
  if (!parsed.success) return null
  const message = parsed.output
  if (message.type !== 'response' || !message.ok) return message as AppRealtimeSocketServerMessage
  const payload = normalizeAppRealtimeResponsePayload(message.action, message.payload)
  if (payload === null) {
    return {
      type: 'response',
      requestId: message.requestId,
      ok: false,
      action: message.action,
      error: APP_REALTIME_INVALID_RESPONSE_PAYLOAD_ERROR,
    } as AppRealtimeSocketServerMessage
  }
  return { ...message, payload } as AppRealtimeSocketServerMessage
}

function normalizeAppRealtimeResponsePayload(action: AppRealtimeRequestAction, payload: unknown): unknown | null {
  if (isAppRealtimeWorkspacePaneTabsAction(action)) {
    return normalizeWorkspacePaneTabsSocketResponsePayload(action, payload)
  }
  switch (action) {
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open:
      return normalizeWorkspacePaneRuntimeOpenResult(payload)
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close:
      return normalizeWorkspacePaneRuntimeCloseResult(payload)
    default:
      return null
  }
}

function normalizeWorkspacePaneTabsSocketResponsePayload(
  action: WorkspacePaneTabsSocketAction,
  payload: unknown,
): unknown | null {
  switch (action) {
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list:
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace:
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update:
      return normalizeWithSchema(WorkspacePaneTabsSnapshotSchema, payload)
  }
}

function normalizeWithSchema<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> | null {
  const parsed = v.safeParse(schema, value)
  return parsed.success ? parsed.output : null
}

export function isAppRealtimeWorkspacePaneTabsAction(
  action: AppRealtimeRequestAction,
): action is WorkspacePaneTabsSocketAction {
  return (
    action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list ||
    action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace ||
    action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update
  )
}

export function isAppRealtimeWorkspacePaneRuntimeAction(
  action: AppRealtimeRequestAction,
): action is WorkspacePaneRuntimeSocketAction {
  return (
    action === WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open || action === WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close
  )
}

export function isAppRealtimeWsMessageWithinLimit(value: string): boolean {
  return appRealtimeUtf8ByteLength(value) <= APP_REALTIME_WS_MESSAGE_LIMIT_BYTES
}

function appRealtimeUtf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}
