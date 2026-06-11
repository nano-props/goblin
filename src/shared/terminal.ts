import * as v from 'valibot'

export type TerminalControllerStatus = 'connected' | 'grace' | 'none'
export type TerminalAttachmentRole = 'controller' | 'viewer' | 'unowned'
export interface TerminalResolvedOwnership {
  role: TerminalAttachmentRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalController {
  attachmentId: string
  status: Exclude<TerminalControllerStatus, 'none'>
}

export interface TerminalAttachInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

export interface TerminalCreateInput {
  repoRoot: string
  branch: string
  worktreePath: string
  kind: 'primary' | 'additional'
  cols?: number
  rows?: number
  attachmentId?: string
}

export interface TerminalRestartInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

export type TerminalTakeoverResult =
  | {
      ok: true
      sessionId: string
      controller: TerminalController | null
      canonicalCols: number
      canonicalRows: number
    }
  | { ok: false; message: string }

export type TerminalAttachResult =
  | {
      ok: true
      sessionId: string
      replay: string
      replaySeq: number
      replayTruncated: boolean
      processName: string
      /** Server-canonical terminal title from the headless session model. */
      canonicalTitle: string | null
      snapshot?: string
      snapshotSeq?: number
      controller: TerminalController | null
      canonicalCols?: number
      canonicalRows?: number
    }
  | { ok: false; message: string }

export type TerminalCatalogAction = 'created' | 'restored' | 'reused'

export type TerminalCatalogMutationResult =
  | {
      ok: true
      action: TerminalCatalogAction
      key: string
      sessions: TerminalSessionSummary[]
    }
  | { ok: false; message: string }

export interface TerminalWriteInput {
  sessionId: string
  data: string
  attachmentId?: string
}

export interface TerminalResizeInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

export type TerminalTakeoverInput = TerminalResizeInput

export interface TerminalSessionInput {
  sessionId: string
}

export interface TerminalNotifyBellInput {
  title: string
  body: string
  key?: string
  /** Clicking the notification focuses Goblin and navigates to this repo's terminal tab. */
  repoRoot: string
}

export interface TerminalListSessionsInput {
  repoRoot: string
}

export interface TerminalSessionSummary {
  sessionId: string
  key: string
  cwd: string
  controller: TerminalController | null
  processName: string
  /** Server-canonical terminal title from the headless session model. */
  canonicalTitle: string | null
  cols: number
  rows: number
}

export interface TerminalSessionSnapshotInput {
  sessionId: string
}

export interface TerminalSessionSnapshot {
  sessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalMutationResult = boolean

export interface TerminalOutputEvent {
  sessionId: string
  data: string
  seq: number
  processName: string
}

export interface TerminalTitleEvent {
  sessionId: string
  /** Server-canonical terminal title from the headless session model. */
  canonicalTitle: string | null
}

export interface TerminalExitEvent {
  sessionId: string
}

export interface TerminalOwnershipEvent {
  sessionId: string
  controller: TerminalController | null
  cols: number
  rows: number
}

export type TerminalRealtimeMessage =
  | { type: 'output'; event: TerminalOutputEvent }
  | { type: 'title'; event: TerminalTitleEvent }
  | { type: 'exit'; event: TerminalExitEvent }
  | { type: 'ownership'; event: TerminalOwnershipEvent }
  | { type: 'sessions-changed'; repoRoot: string }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  close: TerminalSessionInput
  'list-sessions': TerminalListSessionsInput
  create: TerminalCreateInput
  prune: { repoRoot: string }
  'session-snapshot': TerminalSessionSnapshotInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalAttachResult
  write: TerminalMutationResult
  resize: TerminalMutationResult
  takeover: TerminalTakeoverResult
  close: TerminalMutationResult
  'list-sessions': TerminalSessionSummary[]
  create: TerminalCatalogMutationResult
  prune: { pruned: number; remaining: number }
  'session-snapshot': TerminalSessionSnapshot | null
}

export type TerminalSocketRequestAction = keyof TerminalSocketRequestInputs

export type TerminalSocketRequestMessage = {
  [TAction in TerminalSocketRequestAction]: {
    type: 'request'
    requestId: string
    action: TAction
    input: TerminalSocketRequestInputs[TAction]
  }
}[TerminalSocketRequestAction]

export type TerminalSocketResponseMessage =
  | {
      [TAction in TerminalSocketRequestAction]: {
        type: 'response'
        requestId: string
        ok: true
        action: TAction
        payload: TerminalSocketResponseOutputs[TAction]
      }
    }[TerminalSocketRequestAction]
  | {
      [TAction in TerminalSocketRequestAction]: {
        type: 'response'
        requestId: string
        ok: false
        action: TAction
        error: string
      }
    }[TerminalSocketRequestAction]

export type TerminalSocketServerMessage = TerminalRealtimeMessage | TerminalSocketResponseMessage

/** Client → Server realtime messages over the bidirectional WebSocket. */
export type TerminalClientMessage = TerminalSocketRequestMessage

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300
const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const TERMINAL_SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const TERMINAL_ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
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
const TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES = ['connected', 'grace'] satisfies Exclude<TerminalControllerStatus, 'none'>[]
const TerminalSessionIdSchema = v.pipe(v.string(), v.regex(TERMINAL_SESSION_ID_RE))
const TerminalAttachmentIdSchema = v.pipe(v.string(), v.regex(TERMINAL_ATTACHMENT_ID_RE))
const TerminalRequestIdSchema = v.pipe(v.string(), v.regex(TERMINAL_REQUEST_ID_RE))
const TerminalColsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_COLS), v.maxValue(MAX_TERMINAL_COLS))
const TerminalRowsSchema = v.pipe(v.number(), v.integer(), v.minValue(MIN_TERMINAL_ROWS), v.maxValue(MAX_TERMINAL_ROWS))
const TerminalOptionalAttachmentIdSchema = v.optional(TerminalAttachmentIdSchema)
const TerminalControllerSchema = v.object({
  attachmentId: v.string(),
  status: v.picklist(TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES),
})
const TerminalAttachInputSchema = v.object({
  sessionId: TerminalSessionIdSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  attachmentId: TerminalOptionalAttachmentIdSchema,
})
const TerminalRestartInputSchema = TerminalAttachInputSchema
const TerminalWriteInputSchema = v.object({
  sessionId: TerminalSessionIdSchema,
  data: v.pipe(v.string(), v.maxLength(MAX_TERMINAL_WRITE_CHARS)),
  attachmentId: TerminalOptionalAttachmentIdSchema,
})
const TerminalResizeInputSchema = TerminalAttachInputSchema
const TerminalSessionInputSchema = v.object({
  sessionId: TerminalSessionIdSchema,
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
  attachmentId: TerminalOptionalAttachmentIdSchema,
})
const TerminalPruneInputSchema = v.object({
  repoRoot: v.string(),
})
const TerminalSessionSnapshotInputSchema = v.object({
  sessionId: TerminalSessionIdSchema,
})
const TerminalSessionSummarySchema = v.object({
  sessionId: v.string(),
  key: v.string(),
  cwd: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
  cols: v.number(),
  rows: v.number(),
})
const TerminalSessionSnapshotSchema = v.object({
  sessionId: v.string(),
  snapshot: v.string(),
  snapshotSeq: v.number(),
})
const TerminalOutputEventSchema = v.object({
  sessionId: v.string(),
  data: v.string(),
  seq: v.number(),
  processName: v.string(),
})
const TerminalTitleEventSchema = v.object({
  sessionId: v.string(),
  canonicalTitle: v.nullable(v.string()),
})
const TerminalExitEventSchema = v.object({
  sessionId: v.string(),
})
const TerminalOwnershipEventSchema = v.object({
  sessionId: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  cols: v.number(),
  rows: v.number(),
})
const TerminalRealtimeMessageVariants = [
  v.object({ type: v.literal('output'), event: TerminalOutputEventSchema }),
  v.object({ type: v.literal('title'), event: TerminalTitleEventSchema }),
  v.object({ type: v.literal('exit'), event: TerminalExitEventSchema }),
  v.object({ type: v.literal('ownership'), event: TerminalOwnershipEventSchema }),
  v.object({ type: v.literal('sessions-changed'), repoRoot: v.string() }),
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
])

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

export function isValidTerminalAttachmentId(value: unknown): value is string {
  return value === undefined || (typeof value === 'string' && TERMINAL_ATTACHMENT_ID_RE.test(value))
}

export function isValidTerminalNotifyBellInput(value: unknown): value is TerminalNotifyBellInput {
  if (!value || typeof value !== 'object') return false
  const { title, body, key, repoRoot } = value as { title?: unknown; body?: unknown; key?: unknown; repoRoot?: unknown }
  return (
    typeof title === 'string' && title.length > 0 && title.length <= 200 &&
    typeof body === 'string' && body.length > 0 && body.length <= 500 &&
    (key === undefined || (typeof key === 'string' && key.length > 0)) &&
    typeof repoRoot === 'string' && repoRoot.length > 0
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
  return parsed.success ? parsed.output as TerminalSocketServerMessage : null
}

export function normalizeTerminalClientMessage(value: unknown): TerminalClientMessage | null {
  const parsed = v.safeParse(TerminalClientMessageSchema, value)
  return parsed.success ? parsed.output : null
}

export function resolveTerminalAttachmentRole(
  controller: TerminalController | null,
  attachmentId: string,
): TerminalAttachmentRole {
  if (!controller) return 'unowned'
  return controller.attachmentId === attachmentId ? 'controller' : 'viewer'
}

export function resolveTerminalOwnership(
  controller: TerminalController | null,
  attachmentId: string,
): TerminalResolvedOwnership {
  return {
    role: resolveTerminalAttachmentRole(controller, attachmentId),
    controllerStatus: controller?.status ?? 'none',
  }
}

export function cloneTerminalController(controller: TerminalController | null): TerminalController | null {
  return controller ? { ...controller } : null
}

const TERMINAL_ID_INDEX_RE = /^terminal-(\d+)$/

/** Parse a terminal id like `terminal-3` into its 1-based index, or `null` if not a standard id. */
export function parseTerminalIdIndex(terminalId: string): number | null {
  const match = TERMINAL_ID_INDEX_RE.exec(terminalId)
  if (!match) return null
  const index = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(index) && index > 0 ? index : null
}

/** Build a standard terminal id from a 1-based index (e.g. `3` → `terminal-3`). */
export function formatTerminalId(index: number): string {
  return `terminal-${index}`
}
