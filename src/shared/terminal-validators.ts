import * as v from 'valibot'
import type {
  TerminalClientMessage,
  TerminalRealtimeMessage,
  TerminalSocketRequestAction,
  TerminalSocketServerMessage,
} from '#/shared/terminal-socket.ts'
import type {
  TerminalControllerStatus,
  TerminalCreateResult,
  TerminalNotifyBellInput,
  TerminalSessionPhase,
  TerminalSessionSummary,
  TerminalSessionsRecoveryResult,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'
import {
  WorkspacePaneOptionalTabIdentitySchema,
  WorkspacePaneTabEntrySchema,
} from '#/shared/workspace-pane-tabs-validators.ts'

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300
export const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
export const TERMINAL_WS_MESSAGE_LIMIT_BYTES = MAX_TERMINAL_WRITE_CHARS
const TERMINAL_SOCKET_INVALID_RESPONSE_PAYLOAD_ERROR = 'Invalid terminal socket response payload'
const TERMINAL_RUNTIME_SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_SOCKET_ACTIONS = [
  'attach',
  'restart',
  'write',
  'resize',
  'takeover',
  'close',
  'list-sessions',
  'recover-sessions',
  'create',
  'prune',
] as const satisfies TerminalSocketRequestAction[]
const TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES = ['connected'] satisfies Exclude<TerminalControllerStatus, 'none'>[]
const TERMINAL_SESSION_PHASE_VALUES = [
  'opening',
  'restarting',
  'open',
  'error',
  'closed',
] satisfies TerminalSessionPhase[]
const TerminalRuntimeSessionIdSchema = v.pipe(v.string(), v.regex(TERMINAL_RUNTIME_SESSION_ID_RE))
const TerminalClientIdSchema = v.pipe(v.string(), v.regex(TERMINAL_CLIENT_ID_RE))
const TerminalRequestIdSchema = v.pipe(v.string(), v.regex(TERMINAL_REQUEST_ID_RE))
const TerminalColsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_COLS), v.maxValue(MAX_TERMINAL_COLS))
const TerminalRowsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_ROWS), v.maxValue(MAX_TERMINAL_ROWS))
const TerminalWriteDataSchema = v.pipe(
  v.string(),
  v.maxLength(MAX_TERMINAL_WRITE_CHARS),
  v.check((value) => !value.includes('\0'), 'Invalid terminal input'),
)
const TerminalOptionalClientIdSchema = v.optional(TerminalClientIdSchema)
const TerminalControllerSchema = v.object({
  clientId: v.string(),
  status: v.picklist(TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES),
})
const TerminalAttachInputSchema = v.object({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  clientId: TerminalOptionalClientIdSchema,
})
const TerminalRestartInputSchema = TerminalAttachInputSchema
const TerminalWriteInputSchema = v.object({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  data: TerminalWriteDataSchema,
  clientId: TerminalOptionalClientIdSchema,
})
const TerminalResizeInputSchema = TerminalAttachInputSchema
const TerminalSessionInputSchema = v.object({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
})
const RepoRuntimeIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
const TerminalListSessionsInputSchema = v.object({
  repoRoot: v.string(),
  repoRuntimeId: RepoRuntimeIdSchema,
})
const TerminalCreateInputSchema = v.object({
  repoRoot: v.string(),
  repoRuntimeId: RepoRuntimeIdSchema,
  branch: v.string(),
  worktreePath: v.string(),
  kind: v.picklist(['primary', 'additional']),
  startupShellCommand: v.optional(TerminalWriteDataSchema),
  cols: v.optional(TerminalColsSchema),
  rows: v.optional(TerminalRowsSchema),
  clientId: TerminalOptionalClientIdSchema,
  insertAfterIdentity: WorkspacePaneOptionalTabIdentitySchema,
})
const TerminalPruneInputSchema = v.object({
  repoRoot: v.string(),
  repoRuntimeId: RepoRuntimeIdSchema,
})
const TerminalSessionSummarySchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  repoRuntimeId: RepoRuntimeIdSchema,
  repoRoot: v.string(),
  branch: v.string(),
  worktreePath: v.string(),
  cwd: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  cols: v.number(),
  rows: v.number(),
})
const TerminalHydrationSnapshotSchema = v.object({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  snapshot: v.string(),
  snapshotSeq: v.number(),
  outputEra: v.number(),
})
const TerminalSessionsRecoveryResultSchema = v.object({
  sessions: v.array(TerminalSessionSummarySchema),
  snapshots: v.array(TerminalHydrationSnapshotSchema),
})
const TerminalFirstFrameSchemaEntries = {
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  snapshot: v.string(),
  snapshotSeq: v.number(),
  outputEra: v.number(),
  controller: v.nullable(TerminalControllerSchema),
  canonicalCols: TerminalColsSchema,
  canonicalRows: TerminalRowsSchema,
}
const TerminalCreateResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    action: v.picklist(['created', 'restored', 'reused']),
    terminalSessionId: v.string(),
    tabs: v.array(WorkspacePaneTabEntrySchema),
    sessions: v.array(TerminalSessionSummarySchema),
    ...TerminalFirstFrameSchemaEntries,
  }),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalAttachResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    ...TerminalFirstFrameSchemaEntries,
  }),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalTakeoverResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
    role: v.picklist(['controller', 'viewer', 'unowned']),
    controllerStatus: v.picklist(['connected', 'none']),
    controller: v.nullable(TerminalControllerSchema),
    canonicalCols: TerminalColsSchema,
    canonicalRows: TerminalRowsSchema,
    phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  }),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalMutationResultSchema = v.boolean()
const TerminalPruneResultSchema = v.object({
  pruned: v.number(),
  remaining: v.number(),
})
const TerminalOutputEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  data: v.string(),
  outputEra: v.number(),
  seq: v.number(),
  processName: v.string(),
})
const TerminalBellRealtimeEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  repoRoot: v.string(),
  worktreePath: v.string(),
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
})
const TerminalTitleEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  repoRoot: v.string(),
  worktreePath: v.string(),
  canonicalTitle: v.nullable(v.string()),
})
const TerminalExitEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
})
const TerminalSessionClosedEventSchema = v.object({
  type: v.literal('session-closed'),
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  repoRoot: v.string(),
  worktreePath: v.string(),
})

export function isValidTerminalRuntimeSessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_RUNTIME_SESSION_ID_RE.test(value)
}
const TerminalIdentityEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  canonicalCols: v.number(),
  canonicalRows: v.number(),
})
const TerminalLifecycleEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalSessionId: v.string(),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  takeoverPending: v.boolean(),
})
const TerminalRealtimeMessageVariants = [
  v.object({ type: v.literal('output'), event: TerminalOutputEventSchema }),
  v.object({ type: v.literal('bell'), event: TerminalBellRealtimeEventSchema }),
  v.object({ type: v.literal('title'), event: TerminalTitleEventSchema }),
  v.object({ type: v.literal('exit'), event: TerminalExitEventSchema }),
  v.object({ type: v.literal('identity'), event: TerminalIdentityEventSchema }),
  v.object({ type: v.literal('lifecycle'), event: TerminalLifecycleEventSchema }),
  v.object({ type: v.literal('sessions-changed'), repoRoot: v.string() }),
  TerminalSessionClosedEventSchema,
] as const
const TerminalRealtimeMessageSchema = v.variant('type', TerminalRealtimeMessageVariants)
const TerminalSocketServerMessageSchema = v.variant('type', [
  ...TerminalRealtimeMessageVariants,
  v.object({
    type: v.literal('response'),
    requestId: TerminalRequestIdSchema,
    ok: v.literal(true),
    action: v.picklist(TERMINAL_SOCKET_ACTIONS),
    payload: v.unknown(),
  }),
  v.object({
    type: v.literal('response'),
    requestId: TerminalRequestIdSchema,
    ok: v.literal(false),
    action: v.picklist(TERMINAL_SOCKET_ACTIONS),
    error: v.string(),
  }),
])
const TerminalClientMessageSchema = v.variant('type', [
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('attach'),
    input: TerminalAttachInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('restart'),
    input: TerminalRestartInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('write'),
    input: TerminalWriteInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('resize'),
    input: TerminalResizeInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('takeover'),
    input: TerminalResizeInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('close'),
    input: TerminalSessionInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('list-sessions'),
    input: TerminalListSessionsInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('recover-sessions'),
    input: TerminalListSessionsInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('create'),
    input: TerminalCreateInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('prune'),
    input: TerminalPruneInputSchema,
  }),
])

export function terminalUtf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
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

export function isTerminalWsMessageWithinLimit(value: string): boolean {
  return terminalUtf8ByteLength(value) <= TERMINAL_WS_MESSAGE_LIMIT_BYTES
}

export function normalizeTerminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }
  const c = Math.floor(cols)
  const r = Math.floor(rows)
  if (c < MIN_TERMINAL_COLS || c > MAX_TERMINAL_COLS || r < MIN_TERMINAL_ROWS || r > MAX_TERMINAL_ROWS) {
    return null
  }
  return { cols: c, rows: r }
}

export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return normalizeTerminalSize(cols, rows) !== null
}

export function isValidTerminalClientId(value: unknown): value is string {
  return value === undefined || (typeof value === 'string' && TERMINAL_CLIENT_ID_RE.test(value))
}

export function isValidTerminalNotifyBellInput(value: unknown): value is TerminalNotifyBellInput {
  if (!value || typeof value !== 'object') return false
  const { title, body, terminalSessionId, terminalWorktreeKey, repoRoot } = value as {
    title?: unknown
    body?: unknown
    terminalSessionId?: unknown
    terminalWorktreeKey?: unknown
    repoRoot?: unknown
  }
  return (
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 200 &&
    typeof body === 'string' &&
    body.length > 0 &&
    body.length <= 500 &&
    !Object.prototype.hasOwnProperty.call(value, 'key') &&
    (terminalSessionId === undefined || (typeof terminalSessionId === 'string' && terminalSessionId.length > 0)) &&
    (terminalWorktreeKey === undefined ||
      (typeof terminalWorktreeKey === 'string' && terminalWorktreeKey.length > 0)) &&
    typeof repoRoot === 'string' &&
    repoRoot.length > 0
  )
}

export function isValidTerminalTestNotificationInput(value: unknown): value is TerminalTestNotificationInput {
  if (!value || typeof value !== 'object') return false
  const { title, body } = value as { title?: unknown; body?: unknown }
  return (
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 200 &&
    typeof body === 'string' &&
    body.length > 0 &&
    body.length <= 500
  )
}

export function normalizeTerminalSessionSummaryList(value: unknown): TerminalSessionSummary[] | null {
  const parsed = v.safeParse(v.array(TerminalSessionSummarySchema), value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalSessionsRecoveryResult(value: unknown): TerminalSessionsRecoveryResult | null {
  const parsed = v.safeParse(TerminalSessionsRecoveryResultSchema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalCreateResult(value: unknown): TerminalCreateResult | null {
  const parsed = v.safeParse(TerminalCreateResultSchema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalRealtimeMessage(value: unknown): TerminalRealtimeMessage | null {
  const parsed = v.safeParse(TerminalRealtimeMessageSchema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalSocketServerMessage(value: unknown): TerminalSocketServerMessage | null {
  const parsed = v.safeParse(TerminalSocketServerMessageSchema, value)
  if (!parsed.success) return null
  const message = parsed.output
  if (message.type !== 'response' || !message.ok) return message as TerminalSocketServerMessage
  const payload = normalizeTerminalSocketResponsePayload(message.action, message.payload)
  if (payload === null) {
    return {
      type: 'response',
      requestId: message.requestId,
      ok: false,
      action: message.action,
      error: TERMINAL_SOCKET_INVALID_RESPONSE_PAYLOAD_ERROR,
    } as TerminalSocketServerMessage
  }
  return { ...message, payload } as TerminalSocketServerMessage
}

function normalizeTerminalSocketResponsePayload(action: TerminalSocketRequestAction, payload: unknown): unknown | null {
  switch (action) {
    case 'attach':
    case 'restart':
      return normalizeWithSchema(TerminalAttachResultSchema, payload)
    case 'write':
    case 'resize':
    case 'close':
      return normalizeWithSchema(TerminalMutationResultSchema, payload)
    case 'takeover':
      return normalizeWithSchema(TerminalTakeoverResultSchema, payload)
    case 'list-sessions':
      return normalizeWithSchema(v.array(TerminalSessionSummarySchema), payload)
    case 'recover-sessions':
      return normalizeWithSchema(TerminalSessionsRecoveryResultSchema, payload)
    case 'create':
      return normalizeWithSchema(TerminalCreateResultSchema, payload)
    case 'prune':
      return normalizeWithSchema(TerminalPruneResultSchema, payload)
  }
}

function normalizeWithSchema<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> | null {
  const parsed = v.safeParse(schema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalClientMessage(value: unknown): TerminalClientMessage | null {
  const parsed = v.safeParse(TerminalClientMessageSchema, value)
  return parsed.success ? parsed.output : null
}
