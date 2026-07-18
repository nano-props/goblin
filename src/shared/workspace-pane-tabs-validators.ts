import * as v from 'valibot'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_TAB_TYPES,
  WORKSPACE_PANE_STATIC_TAB_IDS,
  WORKSPACE_PANE_STATIC_TAB_TYPES,
} from '#/shared/workspace-pane.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'
import {
  formatWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'

export const RepoRuntimeIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))

export const WorkspacePaneTabIdentitySchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((value) => !value.includes('\0'), 'Invalid workspace pane tab identity'),
)
export const WorkspacePaneOptionalTabIdentitySchema = v.optional(v.nullable(WorkspacePaneTabIdentitySchema))

export const WorkspacePaneTabsListInputSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: RepoRuntimeIdSchema,
})

export const RuntimeWorkspacePaneTargetSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('workspace-root'),
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: RepoRuntimeIdSchema,
  }),
  v.strictObject({
    kind: v.literal('git-branch'),
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: RepoRuntimeIdSchema,
    branch: v.pipe(v.string(), v.minLength(1)),
  }),
  v.strictObject({
    kind: v.literal('git-worktree'),
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: RepoRuntimeIdSchema,
    root: v.string(),
  }),
])

/** Runtime targets that identify a concrete filesystem execution root. */
export const WorkspacePaneFilesystemExecutionTargetSchema = v.pipe(
  v.variant('kind', [
    v.strictObject({
      kind: v.literal('workspace-root'),
      workspaceId: WorkspaceIdSchema,
      workspaceRuntimeId: RepoRuntimeIdSchema,
    }),
    v.strictObject({
      kind: v.literal('git-worktree'),
      workspaceId: WorkspaceIdSchema,
      workspaceRuntimeId: RepoRuntimeIdSchema,
      root: WorkspaceIdSchema,
    }),
  ]),
  v.check(
    (target) => target.kind === 'workspace-root' || workspaceLocatorsShareTransport(target.workspaceId, target.root),
    'Filesystem execution target transport mismatch',
  ),
)

export const WorkspacePaneStaticTabEntrySchema = v.variant('type', [
  v.strictObject({ type: v.literal('status'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.status) }),
  v.strictObject({ type: v.literal('changes'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.changes) }),
  v.strictObject({ type: v.literal('history'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.history) }),
  v.strictObject({ type: v.literal('files'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.files) }),
])
export const WorkspacePaneStaticTabTypeSchema = v.picklist(WORKSPACE_PANE_STATIC_TAB_TYPES)
export const WorkspacePaneRuntimeTabEntrySchema = v.strictObject({
  type: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
  runtimeSessionId: v.pipe(v.string(), v.minLength(1)),
})
export const WorkspacePaneTabEntrySchema = v.union([
  WorkspacePaneStaticTabEntrySchema,
  WorkspacePaneRuntimeTabEntrySchema,
])

export const WorkspacePaneTabsReplaceInputSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: RepoRuntimeIdSchema,
  target: RuntimeWorkspacePaneTargetSchema,
  tabs: v.array(WorkspacePaneTabEntrySchema),
})

export const WorkspacePaneTabsUpdateInputSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: RepoRuntimeIdSchema,
  target: RuntimeWorkspacePaneTargetSchema,
  operation: v.variant('type', [
    v.object({
      type: v.literal('open-static'),
      tabType: WorkspacePaneStaticTabTypeSchema,
      insertAfterIdentity: WorkspacePaneOptionalTabIdentitySchema,
    }),
    v.object({ type: v.literal('close-static'), tabType: WorkspacePaneStaticTabTypeSchema }),
    v.object({ type: v.literal('reorder'), tabIdentities: v.array(WorkspacePaneTabIdentitySchema) }),
  ]),
})

export const WorkspacePaneTabsEntrySchema = v.strictObject({
  target: RuntimeWorkspacePaneTargetSchema,
  tabs: v.array(WorkspacePaneTabEntrySchema),
})

export const WorkspacePaneTabsSnapshotSchema = v.strictObject({
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  entries: v.array(WorkspacePaneTabsEntrySchema),
})

export function normalizeWorkspacePaneTabsSnapshot(value: unknown): WorkspacePaneTabsSnapshot | null {
  const parsed = v.safeParse(WorkspacePaneTabsSnapshotSchema, value)
  if (!parsed.success) return null
  const entries = parsed.output.entries.flatMap((entry) => {
    const target = canonicalRuntimeWorkspacePaneTarget(entry.target)
    return target ? [{ target, tabs: entry.tabs }] : []
  })
  return entries.length === parsed.output.entries.length ? { revision: parsed.output.revision, entries } : null
}

export function canonicalRuntimeWorkspacePaneTarget(
  target: v.InferOutput<typeof RuntimeWorkspacePaneTargetSchema>,
): RuntimeWorkspacePaneTarget | null {
  const workspaceId = canonicalLocator(target.workspaceId)
  if (!workspaceId) return null
  if (target.kind === 'workspace-root') return { ...target, workspaceId }
  if (target.kind === 'git-branch') return { ...target, workspaceId }
  const root = canonicalLocator(target.root)
  if (!root) return null
  if (!workspaceLocatorsShareTransport(workspaceId, root)) return null
  return { ...target, workspaceId, root }
}

function canonicalLocator(value: string) {
  const parsed = parseCanonicalWorkspaceLocator(value)
  const canonical = parsed
    ? formatWorkspaceLocator(parsed, parsed.transport === 'file' ? parsed.platform : 'posix')
    : null
  return canonical === value ? canonical : null
}
