import * as v from 'valibot'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_TAB_TYPES,
  WORKSPACE_PANE_STATIC_TAB_IDS,
  WORKSPACE_PANE_STATIC_TAB_TYPES,
} from '#/shared/workspace-pane.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'

const RepoInstanceIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))

export const WorkspacePaneTabIdentitySchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((value) => !value.includes('\0'), 'Invalid workspace pane tab identity'),
)
export const WorkspacePaneOptionalTabIdentitySchema = v.optional(v.nullable(WorkspacePaneTabIdentitySchema))

export const WorkspacePaneTabsListInputSchema = v.object({
  repoRoot: v.string(),
  repoInstanceId: RepoInstanceIdSchema,
})

export const WorkspacePaneStaticTabEntrySchema = v.variant('type', [
  v.object({ type: v.literal('status'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.status) }),
  v.object({ type: v.literal('changes'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.changes) }),
  v.object({ type: v.literal('history'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.history) }),
  v.object({ type: v.literal('files'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.files) }),
])
export const WorkspacePaneStaticTabTypeSchema = v.picklist(WORKSPACE_PANE_STATIC_TAB_TYPES)
export const WorkspacePaneRuntimeTabEntrySchema = v.object({
  type: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
  runtimeSessionId: v.pipe(v.string(), v.minLength(1)),
})
export const WorkspacePaneTabEntrySchema = v.union([
  WorkspacePaneStaticTabEntrySchema,
  WorkspacePaneRuntimeTabEntrySchema,
])

export const WorkspacePaneTabsReplaceInputSchema = v.object({
  repoRoot: v.string(),
  repoInstanceId: RepoInstanceIdSchema,
  branchName: v.string(),
  worktreePath: v.nullable(v.string()),
  tabs: v.array(WorkspacePaneTabEntrySchema),
})

export const WorkspacePaneTabsUpdateInputSchema = v.object({
  repoRoot: v.string(),
  repoInstanceId: RepoInstanceIdSchema,
  branchName: v.string(),
  worktreePath: v.nullable(v.string()),
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

export const WorkspacePaneTabsEntrySchema = v.object({
  repoRoot: v.string(),
  branchName: v.string(),
  worktreePath: v.nullable(v.string()),
  tabs: v.array(WorkspacePaneTabEntrySchema),
})

export function normalizeWorkspacePaneTabsEntryList(value: unknown): WorkspacePaneTabsEntry[] | null {
  const parsed = v.safeParse(v.array(WorkspacePaneTabsEntrySchema), value)
  return parsed.success ? parsed.output : null
}
