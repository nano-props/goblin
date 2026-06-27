import * as v from 'valibot'
import type {
  TerminalClientMessage,
  TerminalRealtimeMessage,
  TerminalSocketRequestAction,
  TerminalSocketServerMessage,
} from '#/shared/terminal-socket.ts'
import type {
  TerminalControllerStatus,
  TerminalNotifyBellInput,
  TerminalSessionPhase,
  TerminalSessionSnapshot,
  TerminalSessionSummary,
} from '#/shared/terminal-types.ts'

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300
export const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
export const TERMINAL_WS_MESSAGE_LIMIT_BYTES = MAX_TERMINAL_WRITE_CHARS
const TERMINAL_PTY_SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
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
  'create',
  'prune',
  'session-snapshot',
] as const satisfies TerminalSocketRequestAction[]
const TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES = ['connected'] satisfies Exclude<TerminalControllerStatus, 'none'>[]
const TERMINAL_SESSION_PHASE_VALUES = [
  'opening',
  'restarting',
  'open',
  'error',
  'closed',
] satisfies TerminalSessionPhase[]
const TerminalPtySessionIdSchema = v.pipe(v.string(), v.regex(TERMINAL_PTY_SESSION_ID_RE))
const TerminalClientIdSchema = v.pipe(v.string(), v.regex(TERMINAL_CLIENT_ID_RE))
const TerminalRequestIdSchema = v.pipe(v.string(), v.regex(TERMINAL_REQUEST_ID_RE))
const TerminalColsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_COLS), v.maxValue(MAX_TERMINAL_COLS))
const TerminalRowsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_ROWS), v.maxValue(MAX_TERMINAL_ROWS))
const TerminalOptionalClientIdSchema = v.optional(TerminalClientIdSchema)
const TerminalControllerSchema = v.object({
  clientId: v.string(),
  status: v.picklist(TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES),
})
const TerminalAttachInputSchema = v.object({
  ptySessionId: TerminalPtySessionIdSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  clientId: TerminalOptionalClientIdSchema,
})
const TerminalRestartInputSchema = TerminalAttachInputSchema
const TerminalWriteInputSchema = v.object({
  ptySessionId: TerminalPtySessionIdSchema,
  data: v.pipe(v.string(), v.maxLength(MAX_TERMINAL_WRITE_CHARS)),
  clientId: TerminalOptionalClientIdSchema,
})
const TerminalResizeInputSchema = TerminalAttachInputSchema
const TerminalSessionInputSchema = v.object({
  ptySessionId: TerminalPtySessionIdSchema,
})
const TerminalListSessionsInputSchema = v.object({
  repoRoot: v.string(),
})
const TerminalCreateInputSchema = v.object({
  repoRoot: v.string(),
  branch: v.string(),
  worktreePath: v.string(),
  kind: v.picklist(['primary', 'additional']),
  cols: v.optional(TerminalColsSchema),
  rows: v.optional(TerminalRowsSchema),
  clientId: TerminalOptionalClientIdSchema,
})
const TerminalPruneInputSchema = v.object({
  repoRoot: v.string(),
})
const TerminalSessionSnapshotInputSchema = v.object({
  ptySessionId: TerminalPtySessionIdSchema,
})
const TerminalSessionSummarySchema = v.object({
  ptySessionId: v.string(),
  key: v.string(),
  viewType: v.literal('terminal'),
  viewId: v.string(),
  cwd: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  cols: v.number(),
  rows: v.number(),
  displayOrder: v.number(),
})
const TerminalSessionSnapshotSchema = v.object({
  ptySessionId: v.string(),
  snapshot: v.string(),
  snapshotSeq: v.number(),
})
const TerminalOutputEventSchema = v.object({
  ptySessionId: v.string(),
  data: v.string(),
  seq: v.number(),
  processName: v.string(),
})
const TerminalTitleEventSchema = v.object({
  ptySessionId: v.string(),
  canonicalTitle: v.nullable(v.string()),
})
const TerminalExitEventSchema = v.object({
  ptySessionId: v.string(),
})
const TerminalSessionClosedEventSchema = v.object({
  type: v.literal('session-closed'),
  ptySessionId: v.string(),
  repoRoot: v.string(),
})

export function isValidTerminalPtySessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_PTY_SESSION_ID_RE.test(value)
}
const TerminalIdentityEventSchema = v.object({
  ptySessionId: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  canonicalCols: v.number(),
  canonicalRows: v.number(),
})
const TerminalLifecycleEventSchema = v.object({
  ptySessionId: v.string(),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  takeoverPending: v.boolean(),
})
const TerminalRealtimeMessageVariants = [
  v.object({ type: v.literal('output'), event: TerminalOutputEventSchema }),
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
    action: v.literal('create'),
    input: TerminalCreateInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('prune'),
    input: TerminalPruneInputSchema,
  }),
  v.object({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('session-snapshot'),
    input: TerminalSessionSnapshotInputSchema,
  }),
  v.object({
    type: v.literal('heartbeat'),
    at: v.number(),
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
  const { title, body, key, repoRoot } = value as { title?: unknown; body?: unknown; key?: unknown; repoRoot?: unknown }
  return (
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 200 &&
    typeof body === 'string' &&
    body.length > 0 &&
    body.length <= 500 &&
    (key === undefined || (typeof key === 'string' && key.length > 0)) &&
    typeof repoRoot === 'string' &&
    repoRoot.length > 0
  )
}

export function normalizeTerminalSessionSummaryList(value: unknown): TerminalSessionSummary[] | null {
  const parsed = v.safeParse(v.array(TerminalSessionSummarySchema), value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalSessionSnapshot(value: unknown): TerminalSessionSnapshot | null {
  const parsed = v.safeParse(TerminalSessionSnapshotSchema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalRealtimeMessage(value: unknown): TerminalRealtimeMessage | null {
  const parsed = v.safeParse(TerminalRealtimeMessageSchema, value)
  return parsed.success ? parsed.output : null
}

export function normalizeTerminalSocketServerMessage(value: unknown): TerminalSocketServerMessage | null {
  const parsed = v.safeParse(TerminalSocketServerMessageSchema, value)
  return parsed.success ? (parsed.output as TerminalSocketServerMessage) : null
}

export function normalizeTerminalClientMessage(value: unknown): TerminalClientMessage | null {
  const parsed = v.safeParse(TerminalClientMessageSchema, value)
  return parsed.success ? parsed.output : null
}
