import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { ExecResultResponseSchema, WorktreeBootstrapSummaryResponseSchema } from '#/shared/http-response-schema.ts'
import { RemoteTrackingBranchIdentitySchema } from '#/shared/worktree-create.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  GIT_OBJECT_ID_OR_PREFIX_RE,
  gitOperationRequiresDetachedHead,
  hasUniqueRepoWorktreeMaterializedBranches,
  isFullGitObjectId,
} from '#/shared/git-types.ts'

const StringArraySchema = v.array(v.string())
const NullableNumberSchema = v.nullable(v.number())

export const CloneRepoResponseSchema = v.strictObject({
  ...ExecResultResponseSchema.entries,
  path: v.optional(v.string()),
})

const LogEntrySchema = v.strictObject({
  hash: v.pipe(v.string(), v.check(isFullGitObjectId, 'invalid Git object ID')),
  shortHash: v.pipe(v.string(), v.regex(GIT_OBJECT_ID_OR_PREFIX_RE)),
  refs: v.string(),
  message: v.string(),
  author: v.string(),
  date: v.string(),
})
export const RepoLogResponseSchema = v.union([
  v.array(LogEntrySchema),
  v.strictObject({ ok: v.literal(false), message: v.string() }),
])
export const RepoRemoteBranchesResponseSchema = v.array(RemoteTrackingBranchIdentitySchema)

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
  name: v.pipe(v.string(), v.check(isSafeBranchName)),
  isDefault: v.optional(v.boolean()),
  tracking: v.optional(v.string()),
  trackingGone: v.optional(v.boolean()),
  ahead: v.number(),
  behind: v.number(),
  lastCommitHash: v.pipe(v.string(), v.check(isFullGitObjectId, 'invalid Git object ID')),
  lastCommitShortHash: v.pipe(v.string(), v.regex(GIT_OBJECT_ID_OR_PREFIX_RE)),
  lastCommitMessage: v.string(),
  lastCommitDate: v.string(),
  lastCommitAuthor: v.string(),
  mergedToDefault: v.optional(v.boolean()),
})
const RepoRemoteInfoSchema = v.strictObject({
  remotes: v.array(v.strictObject({ name: v.string(), fetchUrl: v.string(), pushUrl: v.string() })),
  hasRemotes: v.boolean(),
  hasBrowserRemote: v.boolean(),
  browserRemoteProvider: v.optional(v.picklist(['github', 'gitlab', 'external'])),
  remoteProviders: v.record(v.string(), v.picklist(['github', 'gitlab', 'external'])),
  hasGitHubRemote: v.boolean(),
})
const GitHeadSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('branch'), branchName: v.string() }),
  v.strictObject({ kind: v.literal('detached') }),
])
const GitOperationSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('rebase') }),
  v.strictObject({ kind: v.literal('merge') }),
  v.strictObject({ kind: v.literal('cherry-pick') }),
  v.strictObject({ kind: v.literal('revert') }),
  v.strictObject({ kind: v.literal('bisect') }),
])
const RepoSnapshotObjectSchema = v.strictObject({
  branches: v.array(BranchSnapshotSchema),
  worktrees: v.array(
    v.strictObject({
      path: v.string(),
      head: GitHeadSchema,
      headOid: v.nullable(v.pipe(v.string(), v.check(isFullGitObjectId, 'invalid Git object ID'))),
      operation: v.nullable(GitOperationSchema),
      materializedBranch: v.nullable(v.string()),
      isPrimary: v.boolean(),
      isLocked: v.boolean(),
    }),
  ),
  current: v.string(),
  remote: RepoRemoteInfoSchema,
})
const RepoSnapshotSchema = v.pipe(
  RepoSnapshotObjectSchema,
  v.check(hasValidWorktreeProjection, 'invalid worktree projection'),
)
export const RepoSnapshotResponseSchema = v.strictObject({
  snapshot: RepoSnapshotSchema,
})

function hasValidWorktreeProjection(snapshot: v.InferOutput<typeof RepoSnapshotObjectSchema>): boolean {
  if (snapshot.current !== '' && !isSafeBranchName(snapshot.current)) return false
  if (!hasUniqueRepoWorktreeMaterializedBranches(snapshot.worktrees)) return false
  if (snapshot.worktrees.filter((worktree) => worktree.isPrimary).length > 1) return false
  if (new Set(snapshot.branches.map((branch) => branch.name)).size !== snapshot.branches.length) return false
  const worktreePaths = new Set<string>()
  const branchNames = new Set(snapshot.branches.map((branch) => branch.name))
  return snapshot.worktrees.every((worktree) => {
    if (worktreePaths.has(worktree.path)) return false
    worktreePaths.add(worktree.path)
    const branchName = worktree.materializedBranch
    if (branchName !== null && !isSafeBranchName(branchName)) return false
    if (worktree.headOid !== null && branchName !== null && !branchNames.has(branchName)) return false
    if (worktree.head.kind === 'branch' && branchName !== worktree.head.branchName) return false
    if (worktree.head.kind === 'branch' && gitOperationRequiresDetachedHead(worktree.operation)) return false
    if (worktree.head.kind === 'detached' && worktree.operation === null && branchName !== null) return false
    if (worktree.headOid === null) {
      if (worktree.head.kind !== 'branch' || worktree.operation !== null) return false
      const { branchName: unbornBranchName } = worktree.head
      if (snapshot.branches.some((branch) => branch.name === unbornBranchName)) return false
    }
    return true
  })
}
export const RepoPullRequestsResponseSchema = v.strictObject({
  pullRequests: v.nullable(v.array(v.strictObject({ branch: v.string(), pullRequest: PullRequestSchema }))),
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
      kind: v.picklist(['fetch', 'pull', 'push', 'create-worktree', 'delete-branch', 'remove-worktree']),
      phase: v.picklist(['queued', 'running', 'cancelling', 'done', 'failed']),
      source: v.picklist(['user', 'background', 'system']),
      target: v.nullable(
        v.strictObject({
          branch: v.optional(v.string()),
          worktreePath: v.optional(v.string()),
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
