// IPC protocol for the dedicated PTY worker. The worker owns only native PTY
// operations; terminal sessions and other business state remain in the host.

import * as v from 'valibot'
import type { PtySpawnInput } from '#/server/terminal/pty-supervisor.ts'

export type PtyWorkerRequest =
  | { type: 'pty-spawn'; requestId: string; ptySessionId: string; input: PtySpawnInput }
  | { type: 'pty-write'; requestId: string; ptySessionId: string; data: string }
  | { type: 'pty-resize'; requestId: string; ptySessionId: string; cols: number; rows: number }
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
  | { type: 'pty-resize-result'; requestId: string; accepted: boolean }
  | { type: 'pty-data'; ptySessionId: string; data: string }
  | { type: 'pty-exit'; ptySessionId: string; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'pty-process-name-changed'; ptySessionId: string; processName: string }

export const PTY_WORKER_REQUEST_ACTIONS = ['pty-spawn', 'pty-write', 'pty-resize', 'pty-kill', 'shutdown'] as const
export type PtyWorkerRequestAction = (typeof PTY_WORKER_REQUEST_ACTIONS)[number]

// Validate the worker → host IPC trust boundary before dispatch.
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
const PtyResizeResultMessageSchema = v.object({
  type: v.literal('pty-resize-result'),
  requestId: PtySessionIdStringSchema,
  accepted: v.boolean(),
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
  PtyResizeResultMessageSchema,
  PtyDataMessageSchema,
  PtyExitMessageSchema,
  PtyProcessNameChangedMessageSchema,
])

export function normalizePtyWorkerMessage(value: unknown): PtyWorkerMessage | null {
  const parsed = v.safeParse(PtyWorkerMessageSchema, value)
  return parsed.success ? (parsed.output as PtyWorkerMessage) : null
}
