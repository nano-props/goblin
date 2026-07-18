import * as v from 'valibot'
import { normalizeTerminalCreateResult, TerminalCreateInputSchema } from '#/shared/terminal-validators.ts'
import type { WorkspacePaneRuntimeOpenInput, WorkspacePaneRuntimeOpenResult } from '#/shared/workspace-pane-runtime.ts'
import type {
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
} from '#/shared/workspace-pane-runtime.ts'
import {
  canonicalRuntimeWorkspacePaneTarget,
  normalizeWorkspacePaneTabsSnapshot,
  WorkspacePaneExecutionTargetSchema,
  WorkspacePaneOptionalTabIdentitySchema,
  WorkspacePaneTabsSnapshotSchema,
} from '#/shared/workspace-pane-tabs-validators.ts'
import { runtimeWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import { isWorkspacePaneRuntimeTabEntry, WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type { TerminalExecutionTarget } from '#/shared/terminal-types.ts'

export const WorkspacePaneRuntimeOpenInputSchema = v.variant('runtimeType', [
  v.strictObject({
    runtimeType: v.literal('terminal'),
    request: TerminalCreateInputSchema,
    insertAfterIdentity: WorkspacePaneOptionalTabIdentitySchema,
  }),
])

const WorkspacePaneRuntimeCommandTargetSchema = v.strictObject({
  target: WorkspacePaneExecutionTargetSchema,
})

export const WorkspacePaneRuntimeCloseInputSchema = v.strictObject({
  runtimeType: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
  sessionId: v.pipe(v.string(), v.minLength(1)),
  target: WorkspacePaneRuntimeCommandTargetSchema,
})

const WorkspacePaneRuntimeOpenResultEnvelopeSchema = v.variant('runtimeType', [
  v.variant('ok', [
    v.strictObject({
      ok: v.literal(true),
      runtimeType: v.literal('terminal'),
      runtime: v.unknown(),
      paneTabsSnapshot: WorkspacePaneTabsSnapshotSchema,
    }),
    v.strictObject({
      ok: v.literal(false),
      runtimeType: v.literal('terminal'),
      message: v.string(),
    }),
  ]),
])

const WorkspacePaneRuntimeCloseResultSchema = v.variant('ok', [
  v.strictObject({
    ok: v.literal(true),
    runtimeType: v.literal('terminal'),
    runtime: v.strictObject({
      action: v.picklist(['closed', 'already-closed']),
      terminalSessionId: v.pipe(v.string(), v.minLength(1)),
      terminalRuntimeSessionId: v.nullable(v.string()),
      terminalRuntimeGeneration: v.nullable(
        v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)),
      ),
    }),
  }),
  v.strictObject({
    ok: v.literal(false),
    runtimeType: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
    message: v.string(),
  }),
])

export function normalizeWorkspacePaneRuntimeOpenInput(value: unknown): WorkspacePaneRuntimeOpenInput | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenInputSchema, value)
  if (!parsed.success) return null
  const target = canonicalRuntimeWorkspacePaneTarget(parsed.output.request.target)
  return target && target.kind !== 'git-branch'
    ? { ...parsed.output, request: { ...parsed.output.request, target } }
    : null
}

export function normalizeWorkspacePaneRuntimeCloseInput(value: unknown): WorkspacePaneRuntimeCloseInput | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeCloseInputSchema, value)
  if (!parsed.success) return null
  const target = canonicalRuntimeWorkspacePaneTarget(parsed.output.target.target)
  return target && target.kind !== 'git-branch'
    ? { ...parsed.output, target: { target } }
    : null
}

export function normalizeWorkspacePaneRuntimeOpenResult(
  value: unknown,
  expectedTarget?: TerminalExecutionTarget,
): WorkspacePaneRuntimeOpenResult | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeOpenResultEnvelopeSchema, value)
  if (!parsed.success) return null
  if (!parsed.output.ok) return parsed.output
  const runtime = normalizeTerminalCreateResult(parsed.output.runtime)
  const paneTabsSnapshot = normalizeWorkspacePaneTabsSnapshot(parsed.output.paneTabsSnapshot)
  if (!runtime?.ok || !paneTabsSnapshot) return null
  const owners = paneTabsSnapshot.entries.filter((entry) =>
    entry.tabs.some(
      (tab) => isWorkspacePaneRuntimeTabEntry(tab) && tab.runtimeSessionId === runtime.terminalSessionId,
    ),
  )
  if (owners.length !== 1) return null
  const owner = owners[0]
  if (!owner || owner.target.kind === 'git-branch' || owner.target.kind !== runtime.presentation.kind) return null
  if (
    expectedTarget &&
    runtimeWorkspacePaneTargetKey(owner.target) !== runtimeWorkspacePaneTargetKey(expectedTarget)
  )
    return null
  return { ...parsed.output, runtime, paneTabsSnapshot }
}

export function normalizeWorkspacePaneRuntimeCloseResult(value: unknown): WorkspacePaneRuntimeCloseResult | null {
  const parsed = v.safeParse(WorkspacePaneRuntimeCloseResultSchema, value)
  return parsed.success ? parsed.output : null
}
