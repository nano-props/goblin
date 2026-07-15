// Wire protocol for the dedicated PTY worker subprocess.
//
// The worker is intentionally a thin node-pty supervisor — it does not
// know about terminal sessions, workspace-pane slots, session services, sockets, or any business state. The
// native host owns the business runtime and talks to the worker over
// IPC for the few low-level operations that have to live close to the
// OS process boundary (spawn / write / resize / kill). Every other
// concern (terminal session lifecycle, worktree grouping, controllers, sockets, session service) is handled
// in-process by the main runtime.
//
// Protocol surface:
//
//   main → worker:
//     pty-spawn    (request)            → pty-spawn-result (with ptySessionId)
//     pty-write    (request)            → pty-write-result
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
  | { type: 'pty-write'; requestId: string; ptySessionId: string; data: string }
  | { type: 'pty-resize'; ptySessionId: string; cols: number; rows: number }
  | { type: 'pty-kill'; ptySessionId: string }
  | { type: 'shutdown' }

export type PtyWorkerSpawnSuccess = {
  type: 'pty-spawn-result'
  requestId: string
  ok: true
  ptySessionId: string
  processName: string
}

export type PtyWorkerSpawnFailure = {
  type: 'pty-spawn-result'
  requestId: string
  ok: false
  error: string
  failure: {
    code: PtyWorkerSpawnFailureCode
    recoverable: boolean
  }
}

export type PtyWorkerSpawnFailureCode = 'native-pty-spawn-failed' | 'unknown'

export type PtyWorkerMessage =
  | PtyWorkerSpawnSuccess
  | PtyWorkerSpawnFailure
  | { type: 'pty-write-result'; requestId: string; status: 'accepted' | 'rejected' | 'indeterminate' }
  | { type: 'pty-data'; ptySessionId: string; data: string }
  | { type: 'pty-exit'; ptySessionId: string; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'pty-process-name-changed'; ptySessionId: string; processName: string }

export const PTY_WORKER_REQUEST_ACTIONS = ['pty-spawn', 'pty-write', 'pty-resize', 'pty-kill', 'shutdown'] as const
export type PtyWorkerRequestAction = (typeof PTY_WORKER_REQUEST_ACTIONS)[number]

// valibot schemas for the worker → main message stream. Trust boundary:
// the worker is bundled with the host binary, so under the current
// deployment this validation is mostly defensive. If the worker ever
// becomes a separately-distributed extension point, this is the
// place that turns "trust the IPC payload" into a parse step.
const PtySessionIdStringSchema = v.pipe(v.string(), v.minLength(1))
const PtySpawnResultSuccessSchema = v.object({
  type: v.literal('pty-spawn-result'),
  requestId: PtySessionIdStringSchema,
  ok: v.literal(true),
  ptySessionId: PtySessionIdStringSchema,
  processName: v.string(),
})
const PtySpawnResultFailureSchema = v.object({
  type: v.literal('pty-spawn-result'),
  requestId: PtySessionIdStringSchema,
  ok: v.literal(false),
  error: v.string(),
  failure: v.object({
    code: v.union([v.literal('native-pty-spawn-failed'), v.literal('unknown')]),
    recoverable: v.boolean(),
  }),
})
const PtyDataMessageSchema = v.object({
  type: v.literal('pty-data'),
  ptySessionId: PtySessionIdStringSchema,
  data: v.string(),
})
const PtyWriteResultMessageSchema = v.object({
  type: v.literal('pty-write-result'),
  requestId: PtySessionIdStringSchema,
  status: v.picklist(['accepted', 'rejected', 'indeterminate']),
})
const PtyExitMessageSchema = v.object({
  type: v.literal('pty-exit'),
  ptySessionId: PtySessionIdStringSchema,
  code: v.nullable(v.number()),
  signal: v.nullable(v.string()),
})
const PtyProcessNameChangedMessageSchema = v.object({
  type: v.literal('pty-process-name-changed'),
  ptySessionId: PtySessionIdStringSchema,
  processName: v.string(),
})
export const PtyWorkerMessageSchema = v.variant('type', [
  PtySpawnResultSuccessSchema,
  PtySpawnResultFailureSchema,
  PtyWriteResultMessageSchema,
  PtyDataMessageSchema,
  PtyExitMessageSchema,
  PtyProcessNameChangedMessageSchema,
])

export function normalizePtyWorkerMessage(value: unknown): PtyWorkerMessage | null {
  const parsed = v.safeParse(PtyWorkerMessageSchema, value)
  return parsed.success ? (parsed.output as PtyWorkerMessage) : null
}
