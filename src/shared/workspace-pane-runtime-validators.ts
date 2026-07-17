import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { normalizeTerminalCreateResult, TerminalCreateInputSchema } from '#/shared/terminal-validators.ts'
import type { WorkspacePaneRuntimeOpenInput, WorkspacePaneRuntimeOpenResult } from '#/shared/workspace-pane-runtime.ts'
import type {
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
} from '#/shared/workspace-pane-runtime.ts'
import { RepoRuntimeIdSchema, WorkspacePaneOptionalTabIdentitySchema } from '#/shared/workspace-pane-tabs-validators.ts'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'

export const WorkspacePaneRuntimeOpenInputSchema = v.variant('runtimeType', [
  v.object({
    runtimeType: v.literal('terminal'),
    request: TerminalCreateInputSchema,
    insertAfterIdentity: WorkspacePaneOptionalTabIdentitySchema,
  }),
])

const WorkspacePaneRuntimeCommandTargetSchema = v.object({
  repoRoot: WorkspaceIdSchema,
  repoRuntimeId: RepoRuntimeIdSchema,
  branchName: v.string(),
  worktreePath: v.string(),
})

export const WorkspacePaneRuntimeCloseInputSchema = v.object({
  runtimeType: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
  sessionId: v.pipe(v.string(), v.minLength(1)),
  target: WorkspacePaneRuntimeCommandTargetSchema,
})

const WorkspacePaneRuntimeOpenResultEnvelopeSchema = v.variant('runtimeType', [
  v.variant('ok', [
    v.object({
      ok: v.literal(true),
      runtimeType: v.literal('terminal'),
      runtime: v.unknown(),
    }),
    v.object({
      ok: v.literal(false),
      runtimeType: v.literal('terminal'),
      message: v.string(),
    }),
  ]),
])

const WorkspacePaneRuntimeCloseResultSchema = v.variant('ok', [
  v.object({
    ok: v.literal(true),
    runtimeType: v.literal('terminal'),
    runtime: v.object({
      action: v.picklist(['closed', 'already-closed']),
      terminalSessionId: v.pipe(v.string(), v.minLength(1)),
      terminalRuntimeSessionId: v.nullable(v.string()),
      terminalRuntimeGeneration: v.nullable(
        v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
      ),
    }),
  }),
  v.object({
    ok: v.literal(false),
    runtimeType: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
    message: v.string(),
  }),
])

export function normalizeWorkspacePaneRuntimeOpenInput(value: unknown): WorkspacePaneRuntimeOpenInput | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenInputSchema, value)
  return parsed.success ? (parsed.output as WorkspacePaneRuntimeOpenInput) : null
}

export function normalizeWorkspacePaneRuntimeCloseInput(value: unknown): WorkspacePaneRuntimeCloseInput | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeCloseInputSchema, value)
  return parsed.success ? (parsed.output as WorkspacePaneRuntimeCloseInput) : null
}

export function normalizeWorkspacePaneRuntimeOpenResult(value: unknown): WorkspacePaneRuntimeOpenResult | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenResultEnvelopeSchema, value)
  if (!parsed.success) return null
  if (!parsed.output.ok) return parsed.output
  const runtime = normalizeTerminalCreateResult(parsed.output.runtime)
  if (!runtime?.ok) return null
  return { ...parsed.output, runtime }
}

export function normalizeWorkspacePaneRuntimeCloseResult(value: unknown): WorkspacePaneRuntimeCloseResult | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeCloseResultSchema, value)
  return parsed.success ? (parsed.output as WorkspacePaneRuntimeCloseResult) : null
}
