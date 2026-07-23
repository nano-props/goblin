import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
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
  TerminalSessionBase,
  TerminalSessionPhase,
  TerminalSessionSummary,
  TerminalSessionsSnapshot,
  TerminalSize,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'
import { isValidBranch } from '#/shared/input-validation.ts'
import {
  canonicalRuntimeWorkspacePaneTarget,
  WorkspacePaneFilesystemExecutionTargetSchema,
  WorkspacePaneTabsSnapshotSchema,
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
  'recover-sessions',
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
const TerminalSizeSchema = v.strictObject({ cols: TerminalColsSchema, rows: TerminalRowsSchema })
const TerminalRuntimeGenerationSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(Number.MAX_SAFE_INTEGER),
)
const TerminalBoundRuntimeGenerationSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(Number.MAX_SAFE_INTEGER),
)
const TerminalOutputSequenceSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const TerminalWriteDataSchema = v.pipe(
  v.string(),
  v.maxLength(MAX_TERMINAL_WRITE_CHARS),
  v.check((value) => !value.includes('\0'), 'Invalid terminal input'),
)
const TerminalControllerSchema = v.object({
  clientId: v.string(),
  status: v.picklist(TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES),
})
const TerminalAttachInputSchema = v.strictObject({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  terminalRuntimeGeneration: TerminalRuntimeGenerationSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
})
const TerminalRestartInputSchema = v.strictObject({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
})
const TerminalWriteInputSchema = v.strictObject({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  data: TerminalWriteDataSchema,
})
const TerminalResizeInputSchema = v.strictObject({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
})
const TerminalTakeoverInputSchema = TerminalResizeInputSchema
const TerminalSessionInputSchema = v.strictObject({
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
})
const WorkspaceRuntimeIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
const TerminalListSessionsInputSchema = v.strictObject({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
})
export const TerminalCreateInputSchema = v.strictObject({
  kind: v.picklist(['primary', 'additional']),
  startupShellCommand: v.optional(TerminalWriteDataSchema),
  target: WorkspacePaneFilesystemExecutionTargetSchema,
})
const TerminalPruneInputSchema = v.strictObject({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
})
const TerminalPresentationSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('workspace-root') }),
  v.strictObject({
    kind: v.literal('git-worktree'),
    head: v.variant('kind', [
      v.strictObject({
        kind: v.literal('branch'),
        branchName: v.pipe(
          v.string(),
          v.check((value: string) => isValidBranch(value)),
        ),
      }),
      v.strictObject({ kind: v.literal('detached') }),
    ]),
  }),
])
const TerminalSessionBaseSchema = v.pipe(
  v.strictObject({
    target: WorkspacePaneFilesystemExecutionTargetSchema,
    presentation: TerminalPresentationSchema,
  }),
  v.check((base) => base.target.kind === base.presentation.kind, 'Terminal target and presentation disagree'),
)
const TerminalNotifyBellInputSchema = v.strictObject({
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  body: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  terminalSessionId: v.pipe(v.string(), v.minLength(1)),
  session: TerminalSessionBaseSchema,
})

function hasConsistentTerminalBindingMetadata(input: {
  terminalRuntimeGeneration: number
  canonicalSize: { cols: number; rows: number } | null
}): boolean {
  return input.terminalRuntimeGeneration === 0 ? input.canonicalSize === null : input.canonicalSize !== null
}

export const TerminalSessionSummarySchema = v.pipe(
  v.strictObject({
    terminalRuntimeSessionId: v.string(),
    terminalRuntimeGeneration: TerminalRuntimeGenerationSchema,
    terminalSessionId: v.string(),
    presentation: TerminalPresentationSchema,
    controller: v.nullable(TerminalControllerSchema),
    processName: v.string(),
    canonicalTitle: v.nullable(v.string()),
    phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
    message: v.nullable(v.string()),
    canonicalSize: v.nullable(TerminalSizeSchema),
    target: WorkspacePaneFilesystemExecutionTargetSchema,
  }),
  v.check((input) => hasConsistentTerminalBindingMetadata(input), 'Terminal binding metadata is inconsistent'),
)
export const TerminalSessionsSnapshotSchema = v.strictObject({
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  sessions: v.array(TerminalSessionSummarySchema),
})
const TerminalRuntimeMetadataSchemaEntries = {
  terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
  terminalRuntimeGeneration: TerminalRuntimeGenerationSchema,
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
  controller: v.nullable(TerminalControllerSchema),
}
const TerminalProjectionNoneEffectSchema = v.strictObject({ kind: v.literal('none') })
const TerminalProjectionDeltaEffectSchema = v.strictObject({
  kind: v.literal('delta'),
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
})
const TerminalProjectionEffectSchema = v.variant('kind', [
  TerminalProjectionNoneEffectSchema,
  TerminalProjectionDeltaEffectSchema,
])
const TerminalCreateResultSchema = v.pipe(
  v.variant('ok', [
    v.strictObject({
      ok: v.literal(true),
      action: v.picklist(['created', 'restored', 'reused']),
      presentation: TerminalPresentationSchema,
      terminalSessionId: v.string(),
      terminalProjectionEffect: TerminalProjectionEffectSchema,
      ...TerminalRuntimeMetadataSchemaEntries,
      canonicalSize: v.nullable(TerminalSizeSchema),
    }),
    v.strictObject({
      ok: v.literal(false),
      message: v.string(),
    }),
  ]),
  v.check(
    (result) => !result.ok || hasConsistentTerminalBindingMetadata(result),
    'Terminal binding metadata is inconsistent',
  ),
)
const TerminalAttachResultSchema = v.variant('ok', [
  v.variant('frame', [
    v.object({
      ok: v.literal(true),
      frame: v.literal('stream'),
      terminalProjectionEffect: TerminalProjectionDeltaEffectSchema,
      ...TerminalRuntimeMetadataSchemaEntries,
      terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
      canonicalSize: TerminalSizeSchema,
      phase: v.literal('open'),
    }),
    v.object({
      ok: v.literal(true),
      frame: v.literal('snapshot'),
      terminalProjectionEffect: TerminalProjectionNoneEffectSchema,
      snapshot: v.string(),
      snapshotSeq: TerminalOutputSequenceSchema,
      ...TerminalRuntimeMetadataSchemaEntries,
      terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
      canonicalSize: TerminalSizeSchema,
    }),
  ]),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalRestartResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    frame: v.literal('stream'),
    terminalProjectionEffect: TerminalProjectionDeltaEffectSchema,
    ...TerminalRuntimeMetadataSchemaEntries,
    terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
    canonicalSize: TerminalSizeSchema,
    phase: v.literal('open'),
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
    terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
    role: v.picklist(['controller', 'viewer', 'unowned']),
    controllerStatus: v.picklist(['connected', 'none']),
    controller: v.nullable(TerminalControllerSchema),
    canonicalSize: TerminalSizeSchema,
    phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  }),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalResizeResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    terminalRuntimeSessionId: TerminalRuntimeSessionIdSchema,
    terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
    canonicalSize: TerminalSizeSchema,
  }),
  v.object({
    ok: v.literal(false),
    message: v.string(),
  }),
])
const TerminalWriteResultSchema = v.variant('status', [
  v.object({ status: v.literal('accepted') }),
  v.object({ status: v.literal('rejected') }),
  v.object({ status: v.literal('indeterminate') }),
])
const TerminalPruneResultSchema = v.object({
  pruned: v.number(),
  remaining: v.number(),
})
const TerminalOutputEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  data: v.string(),
  seq: TerminalOutputSequenceSchema,
  processName: v.string(),
})
const TerminalBellRealtimeEventSchema = v.strictObject({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  workspaceId: WorkspaceIdSchema,
  processName: v.string(),
  canonicalTitle: v.nullable(v.string()),
})
const TerminalTitleEventSchema = v.strictObject({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  workspaceId: WorkspaceIdSchema,
  canonicalTitle: v.nullable(v.string()),
})
const TerminalExitEventSchema = v.strictObject({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
})
const TerminalSessionClosedEventSchema = v.strictObject({
  type: v.literal('session-closed'),
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  workspaceId: WorkspaceIdSchema,
})

export function isValidTerminalRuntimeSessionId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_RUNTIME_SESSION_ID_RE.test(value)
}
const TerminalIdentityEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalBoundRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  controller: v.nullable(TerminalControllerSchema),
  canonicalSize: TerminalSizeSchema,
})
const TerminalLifecycleEventSchema = v.object({
  terminalRuntimeSessionId: v.string(),
  terminalRuntimeGeneration: TerminalRuntimeGenerationSchema,
  terminalSessionId: v.string(),
  phase: v.picklist(TERMINAL_SESSION_PHASE_VALUES),
  message: v.nullable(v.string()),
})
const TerminalRealtimeMessageVariants = [
  v.object({ type: v.literal('output'), event: TerminalOutputEventSchema }),
  v.strictObject({ type: v.literal('bell'), event: TerminalBellRealtimeEventSchema }),
  v.strictObject({ type: v.literal('title'), event: TerminalTitleEventSchema }),
  v.strictObject({ type: v.literal('exit'), event: TerminalExitEventSchema }),
  v.object({ type: v.literal('identity'), event: TerminalIdentityEventSchema }),
  v.object({ type: v.literal('lifecycle'), event: TerminalLifecycleEventSchema }),
  v.strictObject({
    type: v.literal('sessions-changed'),
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
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
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('attach'),
    input: TerminalAttachInputSchema,
  }),
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('restart'),
    input: TerminalRestartInputSchema,
  }),
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('write'),
    input: TerminalWriteInputSchema,
  }),
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('resize'),
    input: TerminalResizeInputSchema,
  }),
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('takeover'),
    input: TerminalTakeoverInputSchema,
  }),
  v.strictObject({
    type: v.literal('request'),
    requestId: TerminalRequestIdSchema,
    action: v.literal('recover-sessions'),
    input: TerminalListSessionsInputSchema,
  }),
  v.strictObject({
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

export function constrainTerminalSize(cols: number, rows: number): TerminalSize | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null
  return {
    cols: Math.min(MAX_TERMINAL_COLS, Math.max(MIN_TERMINAL_COLS, Math.floor(cols))),
    rows: Math.min(MAX_TERMINAL_ROWS, Math.max(MIN_TERMINAL_ROWS, Math.floor(rows))),
  }
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
  return v.safeParse(TerminalNotifyBellInputSchema, value).success
}

export function isValidTerminalSessionBase(value: unknown): value is TerminalSessionBase {
  return v.safeParse(TerminalSessionBaseSchema, value).success
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

export function normalizeTerminalSessionsSnapshot(value: unknown): TerminalSessionsSnapshot | null {
  const parsed = v.safeParse(TerminalSessionsSnapshotSchema, value)
  if (!parsed.success) return null
  const sessions: TerminalSessionSummary[] = []
  for (const session of parsed.output.sessions) {
    const target = canonicalRuntimeWorkspacePaneTarget(session.target)
    if (target?.kind === 'workspace-root' && session.presentation.kind === 'workspace-root') {
      sessions.push({ ...session, target, presentation: session.presentation })
      continue
    }
    if (target?.kind === 'git-worktree' && session.presentation.kind === 'git-worktree') {
      sessions.push({ ...session, target, presentation: session.presentation })
    }
  }
  return sessions.length === parsed.output.sessions.length ? { revision: parsed.output.revision, sessions } : null
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
  if (message.type !== 'response') return normalizeTerminalRealtimeMessage(message)
  if (!message.ok) return message
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
      return normalizeWithSchema(TerminalAttachResultSchema, payload)
    case 'restart':
      return normalizeWithSchema(TerminalRestartResultSchema, payload)
    case 'write':
      return normalizeWithSchema(TerminalWriteResultSchema, payload)
    case 'resize':
      return normalizeWithSchema(TerminalResizeResultSchema, payload)
    case 'takeover':
      return normalizeWithSchema(TerminalTakeoverResultSchema, payload)
    case 'recover-sessions':
      return normalizeTerminalSessionsSnapshot(payload)
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
