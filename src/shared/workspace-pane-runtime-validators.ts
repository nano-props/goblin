import * as v from 'valibot'
import { normalizeTerminalCreateResult, TerminalCreateInputSchema } from '#/shared/terminal-validators.ts'
import type { WorkspacePaneRuntimeOpenInput, WorkspacePaneRuntimeOpenResult } from '#/shared/workspace-pane-runtime.ts'
import { WorkspacePaneTabEntrySchema } from '#/shared/workspace-pane-tabs-validators.ts'

const InsertAfterIdentitySchema = v.optional(
  v.nullable(
    v.pipe(
      v.string(),
      v.minLength(1),
      v.check((value) => !value.includes('\0')),
    ),
  ),
)

export const WorkspacePaneRuntimeOpenInputSchema = v.variant('runtimeType', [
  v.object({
    runtimeType: v.literal('terminal'),
    request: TerminalCreateInputSchema,
    insertAfterIdentity: InsertAfterIdentitySchema,
  }),
])

const WorkspacePaneRuntimeOpenResultEnvelopeSchema = v.variant('runtimeType', [
  v.variant('ok', [
    v.object({
      ok: v.literal(true),
      runtimeType: v.literal('terminal'),
      runtime: v.unknown(),
      tabs: v.array(WorkspacePaneTabEntrySchema),
    }),
    v.object({
      ok: v.literal(false),
      runtimeType: v.literal('terminal'),
      message: v.string(),
    }),
  ]),
])

export function normalizeWorkspacePaneRuntimeOpenInput(value: unknown): WorkspacePaneRuntimeOpenInput | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenInputSchema, value)
  return parsed.success ? (parsed.output as WorkspacePaneRuntimeOpenInput) : null
}

export function normalizeWorkspacePaneRuntimeOpenResult(value: unknown): WorkspacePaneRuntimeOpenResult | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenResultEnvelopeSchema, value)
  if (!parsed.success) return null
  if (!parsed.output.ok) return parsed.output
  const runtime = normalizeTerminalCreateResult(parsed.output.runtime)
  if (!runtime?.ok) return null
  return { ...parsed.output, runtime }
}
