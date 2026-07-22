import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'

const StringArraySchema = v.array(v.string())
const NullableNumberSchema = v.nullable(v.number())

export const CloneRepoResponseSchema = v.strictObject({
  ...ExecResultResponseSchema.entries,
  path: v.optional(v.string()),
})

const LogEntrySchema = v.strictObject({
  hash: v.string(),
  shortHash: v.string(),
  refs: v.string(),
  message: v.string(),
  author: v.string(),
  date: v.string(),
})
export const RepoLogResponseSchema = v.union([
  v.array(LogEntrySchema),
  v.strictObject({ ok: v.literal(false), message: v.string() }),
])
export const RepoRemoteBranchesResponseSchema = StringArraySchema

const PullRequestSchema = v.strictObject({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.picklist(['open', 'merged', 'closed']),
  isDraft: v.optional(v.boolean()),
  createdAt: v.optional(v.string()),
  author: v.optional(v.string()),
  baseRefName: v.optional(v.string()),
  headRefName: v.optional(v.string()),
  headRepositoryOwner: v.optional(v.string()),
  isCrossRepository: v.optional(v.boolean()),
  checks: v.optional(
    v.strictObject({ total: v.number(), passing: v.number(), failing: v.number(), pending: v.number() }),
  ),
  reviewDecision: v.optional(v.nullable(v.picklist(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']))),
  mergeable: v.optional(v.picklist(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
})
const BranchSnapshotSchema = v.strictObject({
  name: v.string(),
  isCurrent: v.boolean(),
  isDefault: v.optional(v.boolean()),
  tracking: v.optional(v.string()),
  trackingGone: v.optional(v.boolean()),
  ahead: v.number(),
  behind: v.number(),
  lastCommitHash: v.string(),
  lastCommitShortHash: v.string(),
  lastCommitMessage: v.string(),
  lastCommitDate: v.string(),
  lastCommitAuthor: v.string(),
  worktree: v.optional(
    v.strictObject({
      path: v.string(),
      isPrimary: v.optional(v.boolean()),
      isLocked: v.optional(v.boolean()),
      summary: v.optional(
        v.strictObject({ dirty: v.optional(v.boolean()), changeCount: v.optional(v.number()) }),
      ),
    }),
  ),
  mergedToDefault: v.optional(v.boolean()),
  pullRequest: v.optional(PullRequestSchema),
})
const RepoRemoteInfoSchema = v.strictObject({
  remotes: v.array(v.strictObject({ name: v.string(), fetchUrl: v.string(), pushUrl: v.string() })),
  hasRemotes: v.boolean(),
  hasBrowserRemote: v.boolean(),
  browserRemoteProvider: v.optional(v.picklist(['github', 'gitlab', 'external'])),
  remoteProviders: v.record(v.string(), v.picklist(['github', 'gitlab', 'external'])),
  hasGitHubRemote: v.boolean(),
})
const RepoSnapshotSchema = v.strictObject({
  branches: v.array(BranchSnapshotSchema),
  current: v.string(),
  currentHEAD: v.optional(v.string()),
  remote: v.optional(RepoRemoteInfoSchema),
})
export const RepoProjectionResponseSchema = v.strictObject({
  snapshot: v.nullable(RepoSnapshotSchema),
  pullRequests: v.nullable(
    v.array(v.strictObject({ branch: v.string(), pullRequest: PullRequestSchema })),
  ),
  requested: v.strictObject({ branch: v.nullable(v.string()), pullRequestMode: v.picklist(['summary', 'full']) }),
  loadedAt: v.number(),
})

const StatusEntrySchema = v.strictObject({ x: v.string(), y: v.string(), path: v.string() })
export const RepoWorktreeStatusResponseSchema = v.strictObject({
  workspaceRuntimeId: v.string(),
  status: v.array(
    v.strictObject({
      path: v.string(),
      branch: v.optional(v.string()),
      isMain: v.boolean(),
      entries: v.array(StatusEntrySchema),
    }),
  ),
  loadedAt: v.number(),
})

const CancellationReasonSchema = v.picklist([
  'caller-abort',
  'request-watchdog-timeout',
  'git-timeout',
  'network-op-superseded',
])
export const RepoOperationsResponseSchema = v.strictObject({
  operations: v.array(
    v.strictObject({
      id: v.string(),
      repoId: v.nullable(WorkspaceIdSchema),
      workspaceRuntimeId: v.nullable(v.string()),
      kind: v.picklist(['fetch', 'clone', 'pull', 'push', 'create-worktree', 'delete-branch', 'remove-worktree', 'network']),
      phase: v.picklist(['queued', 'running', 'cancelling', 'done', 'failed']),
      source: v.picklist(['user', 'background', 'system']),
      target: v.nullable(
        v.strictObject({
          branch: v.optional(v.string()),
          worktreePath: v.optional(v.string()),
          parentPath: v.optional(v.string()),
          directoryName: v.optional(v.string()),
        }),
      ),
      queuedAt: v.number(),
      startedAt: NullableNumberSchema,
      deadlineAt: NullableNumberSchema,
      settledAt: NullableNumberSchema,
      error: v.nullable(v.strictObject({ message: v.string(), reason: v.nullable(CancellationReasonSchema) })),
      cancellation: v.strictObject({
        underlyingRequested: v.boolean(),
        reason: v.nullable(CancellationReasonSchema),
        requestedAt: NullableNumberSchema,
        waitCancelledCount: v.number(),
        lastWaitCancelledAt: NullableNumberSchema,
        lastWaitCancellationReason: v.nullable(CancellationReasonSchema),
      }),
      canCancelUnderlying: v.boolean(),
    }),
  ),
  lastFetchAt: NullableNumberSchema,
  loadedAt: v.number(),
})

const WorktreeBootstrapPreviewSchema = v.strictObject({
  hasConfig: v.boolean(),
  hasOperations: v.boolean(),
  configHash: v.nullable(v.string()),
  copyCount: v.number(),
  symlinkCount: v.number(),
  hardlinkCount: v.number(),
  excludeCount: v.number(),
  setup: v.optional(v.strictObject({ command: v.string() })),
})
export const WorktreeBootstrapPreviewResponseSchema = v.variant('ok', [
  v.strictObject({ ok: v.literal(true), preview: WorktreeBootstrapPreviewSchema }),
  v.strictObject({ ok: v.literal(false), message: v.string() }),
])

export const BackgroundSyncReposResponseSchema = v.strictObject({
  ok: v.literal(true),
  repoIds: v.array(WorkspaceIdSchema),
  intervalSec: v.number(),
})
