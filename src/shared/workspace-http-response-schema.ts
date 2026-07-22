import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { WorkspaceRuntimeIdSchema } from '#/shared/workspace-pane-tabs-validators.ts'
import { REMOTE_DIAGNOSTIC_CATEGORIES, REMOTE_WORKSPACE_FAILURE_REASONS } from '#/shared/remote-workspace.ts'

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty())
const NonNegativeIntegerSchema = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0))

export const AckResponseSchema = v.strictObject({ ok: v.literal(true) })
export const StringArrayResponseSchema = v.array(v.string())

function pathSummarySchema() {
  return v.strictObject({ count: NonNegativeIntegerSchema, paths: v.array(v.string()) })
}

export const WorkspaceCapabilitiesResponseSchema = v.strictObject({
  files: v.strictObject({ read: v.literal(true), write: v.boolean() }),
  terminal: v.strictObject({ available: v.boolean() }),
  git: v.variant('status', [
    v.strictObject({ status: v.literal('unavailable') }),
    v.strictObject({
      status: v.literal('available'),
      worktrees: v.boolean(),
      pullRequests: v.variant('provider', [
        v.strictObject({ provider: v.literal('github') }),
        v.strictObject({ provider: v.literal('none') }),
      ]),
    }),
  ]),
})

export const WorkspaceDiagnosticResponseSchema = v.strictObject({
  scope: v.picklist(['git', 'transport']),
  message: v.string(),
})

const WorkspaceProbingResponseSchema = v.strictObject({ status: v.literal('probing') })
const WorkspaceUnavailableResponseSchema = v.strictObject({
  status: v.literal('unavailable'),
  reason: v.picklist([
    'error.workspace-locator-malformed',
    'error.workspace-transport-unsupported',
    'error.workspace-path-not-found',
    'error.workspace-path-not-directory',
    'error.workspace-permission-denied',
    'error.workspace-transport-unavailable',
  ]),
})

export const WorkspaceGitReadyProbeResponseSchema = v.strictObject({
  status: v.literal('ready'),
  name: v.string(),
  capabilities: v.strictObject({
    files: v.strictObject({ read: v.literal(true), write: v.boolean() }),
    terminal: v.strictObject({ available: v.boolean() }),
    git: v.strictObject({
      status: v.literal('available'),
      worktrees: v.boolean(),
      pullRequests: v.variant('provider', [
        v.strictObject({ provider: v.literal('github') }),
        v.strictObject({ provider: v.literal('none') }),
      ]),
    }),
  }),
  diagnostics: v.array(WorkspaceDiagnosticResponseSchema),
})

const WorkspaceReadyWithoutGitResponseSchema = v.strictObject({
  status: v.literal('ready'),
  name: v.string(),
  capabilities: v.strictObject({
    files: v.strictObject({ read: v.literal(true), write: v.boolean() }),
    terminal: v.strictObject({ available: v.boolean() }),
    git: v.strictObject({ status: v.literal('unavailable') }),
  }),
  diagnostics: v.array(WorkspaceDiagnosticResponseSchema),
})

const WorkspaceReadyResponseSchema = v.strictObject({
  status: v.literal('ready'),
  name: v.string(),
  capabilities: WorkspaceCapabilitiesResponseSchema,
  diagnostics: v.array(WorkspaceDiagnosticResponseSchema),
})

export const WorkspaceProbeWithoutGitProjectionResponseSchema = v.variant('status', [
  WorkspaceProbingResponseSchema,
  WorkspaceReadyWithoutGitResponseSchema,
  WorkspaceUnavailableResponseSchema,
])

export const WorkspaceProbeStateResponseSchema = v.variant('status', [
  WorkspaceProbingResponseSchema,
  WorkspaceReadyResponseSchema,
  WorkspaceUnavailableResponseSchema,
])

const WorkspaceSettledProbeStateResponseSchema = v.variant('status', [
  v.strictObject({
    status: v.literal('ready'),
    name: v.string(),
    capabilities: WorkspaceCapabilitiesResponseSchema,
    diagnostics: v.array(WorkspaceDiagnosticResponseSchema),
  }),
  v.strictObject({
    status: v.literal('unavailable'),
    reason: v.picklist([
      'error.workspace-locator-malformed',
      'error.workspace-transport-unsupported',
      'error.workspace-path-not-found',
      'error.workspace-path-not-directory',
      'error.workspace-permission-denied',
      'error.workspace-transport-unavailable',
    ]),
  }),
])

export const RemoteWorkspaceTargetResponseSchema = v.strictObject({
  id: WorkspaceIdSchema,
  alias: NonEmptyStringSchema,
  remotePath: v.pipe(v.string(), v.check((value) => value.startsWith('/') && !value.includes('\0'))),
  displayName: NonEmptyStringSchema,
  host: NonEmptyStringSchema,
  user: v.string(),
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  sshConnection: v.optional(
    v.strictObject({ destination: NonEmptyStringSchema, options: v.array(NonEmptyStringSchema) }),
  ),
})

export const RemoteRuntimeLifecycleResponseSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('idle'), attemptId: NonNegativeIntegerSchema }),
  v.strictObject({ kind: v.literal('connecting'), attemptId: NonNegativeIntegerSchema }),
  v.strictObject({ kind: v.literal('ready'), attemptId: NonNegativeIntegerSchema, target: RemoteWorkspaceTargetResponseSchema }),
  v.strictObject({
    kind: v.literal('failed'),
    attemptId: NonNegativeIntegerSchema,
    reason: v.picklist(REMOTE_WORKSPACE_FAILURE_REASONS),
    target: v.optional(RemoteWorkspaceTargetResponseSchema),
  }),
])

const WorkspaceRuntimeEntryResponseSchema = v.strictObject({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  remoteLifecycle: v.optional(v.nullable(RemoteRuntimeLifecycleResponseSchema)),
  workspaceProbe: WorkspaceProbeStateResponseSchema,
})

export const WorkspaceRuntimesResponseSchema = v.strictObject({ runtimes: v.array(WorkspaceRuntimeEntryResponseSchema) })
export const WorkspaceRuntimeOpenIdResponseSchema = v.strictObject({
  ok: v.literal(true),
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
})
export const WorkspaceRuntimeOpenResponseSchema = v.variant('ok', [
  v.strictObject({
    ok: v.literal(true),
    workspace: v.strictObject({ id: WorkspaceIdSchema, name: v.string() }),
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    capabilities: WorkspaceCapabilitiesResponseSchema,
    diagnostics: v.array(WorkspaceDiagnosticResponseSchema),
  }),
  v.strictObject({ ok: v.literal(false), input: v.string(), reason: NonEmptyStringSchema }),
])
export const WorkspaceRuntimeCloseResponseSchema = v.strictObject({
  ok: v.literal(true),
  released: v.boolean(),
  runtimeClosed: v.boolean(),
})
export const WorkspaceRefreshResponseSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('committed'), probe: WorkspaceSettledProbeStateResponseSchema }),
  v.strictObject({ kind: v.literal('failed'), probe: WorkspaceSettledProbeStateResponseSchema }),
  v.strictObject({ kind: v.literal('stale-runtime') }),
])
export const WorkspaceDirectoryOverviewResponseSchema = v.strictObject({
  topLevelFileCount: NonNegativeIntegerSchema,
  topLevelDirectoryCount: NonNegativeIntegerSchema,
  totalSizeBytes: v.nullable(NonNegativeIntegerSchema),
})

export const WorkspaceFilesystemTreeResponseSchema = v.strictObject({
  nodes: v.array(
    v.strictObject({
      id: v.string(),
      path: v.string(),
      name: v.string(),
      parentId: v.nullable(v.string()),
      kind: v.picklist(['directory', 'file']),
      status: v.picklist(['clean', 'modified', 'staged', 'untracked', 'ignored']),
      hasChildren: v.optional(v.boolean()),
    }),
  ),
  truncated: v.boolean(),
})
export const WorkspaceFileViewerResponseSchema = v.strictObject({
  viewer: v.picklist(['bat', 'batcat', 'cat', 'type']),
  shell: v.picklist(['posix', 'cmd']),
  executionRoot: NonEmptyStringSchema,
})

export const ResolveRemoteTargetResponseSchema = v.union([
  v.strictObject({ target: RemoteWorkspaceTargetResponseSchema }),
  v.strictObject({ error: NonEmptyStringSchema }),
])
export const SshConfigHostsResponseSchema = v.strictObject({
  hosts: v.array(
    v.strictObject({
      alias: NonEmptyStringSchema,
      hostName: v.optional(NonEmptyStringSchema),
      user: v.optional(NonEmptyStringSchema),
      port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))),
    }),
  ),
  hasInclude: v.boolean(),
})
export const RemoteLifecycleResponseSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('settled'),
    workspaceId: WorkspaceIdSchema,
    name: v.string(),
    lifecycle: v.variant('kind', [
      v.strictObject({ kind: v.literal('ready'), attemptId: NonNegativeIntegerSchema, target: RemoteWorkspaceTargetResponseSchema }),
      v.strictObject({
        kind: v.literal('failed'),
        attemptId: NonNegativeIntegerSchema,
        reason: v.picklist(REMOTE_WORKSPACE_FAILURE_REASONS),
        target: v.optional(RemoteWorkspaceTargetResponseSchema),
      }),
    ]),
  }),
  v.strictObject({ kind: v.literal('superseded'), workspaceId: WorkspaceIdSchema }),
  v.strictObject({ kind: v.literal('stale-runtime'), workspaceId: WorkspaceIdSchema }),
])
export const RemoteDiagnosticsResponseSchema = v.strictObject({
  target: RemoteWorkspaceTargetResponseSchema,
  ok: v.boolean(),
  stages: v.array(
    v.strictObject({
      name: v.picklist(['ssh', 'shell', 'git', 'path', 'repo']),
      label: v.string(),
      status: v.picklist(['pending', 'running', 'passed', 'failed', 'skipped']),
      category: v.optional(v.picklist(REMOTE_DIAGNOSTIC_CATEGORIES)),
      message: v.optional(v.string()),
      details: v.optional(v.string()),
    }),
  ),
  category: v.optional(v.picklist(REMOTE_DIAGNOSTIC_CATEGORIES)),
  message: v.optional(v.string()),
  details: v.optional(v.string()),
  gitAtWorkspaceRoot: v.optional(v.boolean()),
})
