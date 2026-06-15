// Wire protocol for the dedicated PTY worker subprocess.
//
// The worker is intentionally a thin node-pty supervisor — it does not
// know about sessions, catalogs, sockets, or any business state. The
// main process owns the business runtime and talks to the worker over
// IPC for the few low-level operations that have to live close to the
// OS process boundary (spawn / write / resize / kill). Every other
// concern (session lifecycle, ownership, sockets, catalog) is handled
// in-process by the main runtime.
//
// Protocol surface (8 message types total):
//
//   main → worker:
//     pty-spawn    (request)            → pty-spawn-result (with sessionId)
//     pty-write    (fire-and-forget)
//     pty-resize   (fire-and-forget)
//     pty-kill     (fire-and-forget)
//     shutdown     (fire-and-forget)
//
//   worker → main:
//     pty-data             (event)
//     pty-exit             (event)
//     pty-process-name-changed (event)

import * as v from 'valibot'
import type { PtySpawnInput } from '#/server/terminal/pty-supervisor.ts'

export type PtyWorkerRequest =
  | { type: 'pty-spawn'; requestId: string; input: PtySpawnInput }
  | { type: 'pty-write'; sessionId: string; data: string }
  | { type: 'pty-resize'; sessionId: string; cols: number; rows: number }
  | { type: 'pty-kill'; sessionId: string }
  | { type: 'shutdown' }

export type PtyWorkerSpawnSuccess = {
  type: 'pty-spawn-result'
  requestId: string
  ok: true
  sessionId: string
  processName: string
}

export type PtyWorkerSpawnFailure = {
  type: 'pty-spawn-result'
  requestId: string
  ok: false
  error: string
}

export type PtyWorkerMessage =
  | PtyWorkerSpawnSuccess
  | PtyWorkerSpawnFailure
  | { type: 'pty-data'; sessionId: string; data: string }
  | { type: 'pty-exit'; sessionId: string; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'pty-process-name-changed'; sessionId: string; processName: string }

export const PTY_WORKER_REQUEST_ACTIONS = ['pty-spawn', 'pty-write', 'pty-resize', 'pty-kill', 'shutdown'] as const
export type PtyWorkerRequestAction = (typeof PTY_WORKER_REQUEST_ACTIONS)[number]

// valibot schemas for the worker → main message stream. Trust boundary:
// the worker is bundled with the host binary, so under the current
// deployment this validation is mostly defensive. If the worker ever
// becomes a separately-distributed extension point, this is the
// place that turns "trust the IPC payload" into a parse step.
const SessionIdStringSchema = v.pipe(v.string(), v.minLength(1))
const PtySpawnResultSuccessSchema = v.object({
  type: v.literal('pty-spawn-result'),
  requestId: SessionIdStringSchema,
  ok: v.literal(true),
  sessionId: SessionIdStringSchema,
  processName: v.string(),
})
const PtySpawnResultFailureSchema = v.object({
  type: v.literal('pty-spawn-result'),
  requestId: SessionIdStringSchema,
  ok: v.literal(false),
  error: v.string(),
})
const PtyDataMessageSchema = v.object({
  type: v.literal('pty-data'),
  sessionId: SessionIdStringSchema,
  data: v.string(),
})
const PtyExitMessageSchema = v.object({
  type: v.literal('pty-exit'),
  sessionId: SessionIdStringSchema,
  code: v.nullable(v.number()),
  signal: v.nullable(v.string()),
})
const PtyProcessNameChangedMessageSchema = v.object({
  type: v.literal('pty-process-name-changed'),
  sessionId: SessionIdStringSchema,
  processName: v.string(),
})
export const PtyWorkerMessageSchema = v.variant('type', [
  PtySpawnResultSuccessSchema,
  PtySpawnResultFailureSchema,
  PtyDataMessageSchema,
  PtyExitMessageSchema,
  PtyProcessNameChangedMessageSchema,
])

export function normalizePtyWorkerMessage(value: unknown): PtyWorkerMessage | null {
  const parsed = v.safeParse(PtyWorkerMessageSchema, value)
  return parsed.success ? (parsed.output as PtyWorkerMessage) : null
}
