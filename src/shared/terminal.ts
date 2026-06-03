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

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300
const TERMINAL_ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES = ['connected', 'grace'] satisfies Exclude<TerminalControllerStatus, 'none'>[]
const TerminalControllerSchema = v.object({
  attachmentId: v.string(),
  status: v.picklist(TERMINAL_CONNECTED_CONTROLLER_STATUS_VALUES),
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
const TerminalRealtimeMessageSchema = v.variant('type', [
  v.object({ type: v.literal('output'), event: TerminalOutputEventSchema }),
  v.object({ type: v.literal('title'), event: TerminalTitleEventSchema }),
  v.object({ type: v.literal('exit'), event: TerminalExitEventSchema }),
  v.object({ type: v.literal('ownership'), event: TerminalOwnershipEventSchema }),
  v.object({ type: v.literal('sessions-changed'), repoRoot: v.string() }),
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
