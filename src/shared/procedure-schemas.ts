// Procedure input schemas shared between the HTTP route layer and the
// native bridge IPC layer. Each transport validates payloads with
// `parseHttpInput` (see `#/server/common/http-validate.ts`) or
// `parseIpcInput` (see `#/shared/api-types.ts`) using the schemas
// declared here, so the request contract is defined once.
//
// Primitive reusable schemas (CwdInput and Remote*Schema)
// live in `#/shared/api-types.ts` next to the IPC types they describe.

import * as v from 'valibot'
import {
  CwdInput,
  RemoteConnectionInputSchema,
  RemotePathSuggestionsInputSchema,
  RemoteWorkspaceTargetSchema,
} from '#/shared/api-types.ts'
import { NativeHostProjectionSchema } from '#/shared/native-host-projection.ts'
import { WorkspaceFilesystemPathSchema } from '#/shared/workspace-filesystem-schema.ts'
import { GIT_HASH_RE } from '#/shared/git-types.ts'
import { WORKTREE_BOOTSTRAP_CONFIG_HASH_RE } from '#/shared/workspace-settings.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { WorkspacePaneFilesystemExecutionTargetSchema } from '#/shared/workspace-pane-tabs-validators.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'

const StringArray = v.array(v.string())
const TerminalAppSchema = v.picklist(['ghostty', 'terminal', 'windowsTerminal'])
const EditorAppSchema = v.picklist(['vscode'])
const WorktreeBootstrapConfigHashSchema = v.pipe(v.string(), v.regex(WORKTREE_BOOTSTRAP_CONFIG_HASH_RE))
const WorkspaceRuntimeIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
const RepoUrlTargetSchema = v.variant('type', [
  v.object({ type: v.literal('root') }),
  // `remote` is an optional hint for which remote to resolve the URL against
  // (e.g. clicking an `origin/main` upstream chip should open `origin`, not
  // whatever `pickBrowserRemote` would have guessed from the local branch).
  v.object({
    type: v.literal('branch'),
    branch: v.string(),
    remote: v.optional(v.string()),
  }),
  v.object({ type: v.literal('commit'), hash: v.pipe(v.string(), v.regex(GIT_HASH_RE)) }),
])
const WorktreeBootstrapDecisionSchema = v.variant('kind', [
  v.object({ kind: v.literal('skip') }),
  // `configTrusted` is the desired post-bootstrap trust state for `configHash`,
  // not an assertion about the settings snapshot at request time.
  v.object({ kind: v.literal('run'), configHash: WorktreeBootstrapConfigHashSchema, configTrusted: v.boolean() }),
])

const RemoteWorkspaceRefSchema = v.object({
  id: WorkspaceIdSchema,
  alias: v.string(),
  remotePath: v.string(),
  displayName: v.string(),
})

const WorkspaceSessionEntrySchema = v.variant('kind', [
  v.object({ kind: v.literal('local'), id: WorkspaceIdSchema }),
  v.object({ kind: v.literal('remote'), id: WorkspaceIdSchema, ref: RemoteWorkspaceRefSchema }),
])
const ClientIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
const WorkspaceRuntimeOpenSchema = v.union([
  v.object({ workspaceId: WorkspaceIdSchema, clientId: ClientIdSchema }),
  v.object({ workspaceInput: v.string(), clientId: ClientIdSchema }),
])
const WorkspaceRuntimeCloseSchema = v.object({
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
  clientId: ClientIdSchema,
})
const EmptyBodySchema = v.optional(v.object({}))

export const WORKSPACE_PROCEDURE_SCHEMAS = {
  refresh: v.object({
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  }),
  runtimeOpen: WorkspaceRuntimeOpenSchema,
  runtimeReconcile: v.object({
    clientId: ClientIdSchema,
    workspaceIds: v.pipe(v.array(WorkspaceIdSchema), v.maxLength(100)),
  }),
  runtimeList: EmptyBodySchema,
  runtimeClose: WorkspaceRuntimeCloseSchema,
  tree: v.object({
    target: WorkspacePaneFilesystemExecutionTargetSchema,
    prefix: v.optional(WorkspaceFilesystemPathSchema),
  }),
  trashFile: v.object({
    target: WorkspacePaneFilesystemExecutionTargetSchema,
    path: WorkspaceFilesystemPathSchema,
  }),
  fileViewer: v.object({ target: WorkspacePaneFilesystemExecutionTargetSchema }),
  openTerminal: v.object({
    target: WorkspacePaneFilesystemExecutionTargetSchema,
    app: TerminalAppSchema,
  }),
  openEditor: v.object({
    target: WorkspacePaneFilesystemExecutionTargetSchema,
    app: EditorAppSchema,
  }),
  openInFinder: v.object({ target: WorkspacePaneFilesystemExecutionTargetSchema }),
} as const

export const REPO_PROCEDURE_SCHEMAS = {
  // Action endpoints — POST with a JSON body.
  fetch: v.strictObject({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  }),
  clone: v.object({
    url: v.string(),
    parentPath: v.string(),
    directoryName: v.string(),
  }),
  pull: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    branch: v.string(),
    worktreePath: v.optional(v.string()),
  }),
  push: v.object({ cwd: WorkspaceIdSchema, workspaceRuntimeId: WorkspaceRuntimeIdSchema, branch: v.string() }),
  createWorktree: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    worktreePath: v.string(),
    mode: v.variant('kind', [
      v.object({ kind: v.literal('newBranch'), newBranch: v.string(), baseRef: v.string() }),
      v.object({ kind: v.literal('existingBranch'), branch: v.string() }),
      v.object({ kind: v.literal('trackRemoteBranch'), remoteRef: v.string(), localBranch: v.string() }),
    ]),
    worktreeBootstrap: WorktreeBootstrapDecisionSchema,
  }),
  getRemoteBranches: v.object({ cwd: WorkspaceIdSchema, workspaceRuntimeId: WorkspaceRuntimeIdSchema }),
  worktreeBootstrapPreview: v.object({ cwd: WorkspaceIdSchema, workspaceRuntimeId: WorkspaceRuntimeIdSchema }),
  deleteBranch: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    branch: v.string(),
    force: v.optional(v.boolean()),
    deleteUpstream: v.optional(v.boolean()),
  }),
  removeWorktree: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    branch: v.string(),
    worktreePath: v.string(),
    deleteBranch: v.boolean(),
    forceDeleteBranch: v.optional(v.boolean()),
    deleteUpstream: v.optional(v.boolean()),
  }),
  openUrl: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    target: RepoUrlTargetSchema,
  }),
  backgroundSyncRepos: v.object({
    clientId: ClientIdSchema,
    revision: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER)),
    targets: v.pipe(
      v.array(
        v.object({
          workspaceId: WorkspaceIdSchema,
          workspaceRuntimeId: WorkspaceRuntimeIdSchema,
        }),
      ),
      v.maxLength(100),
      v.transform((targets): GitBackgroundSyncTarget[] => targets),
    ),
  }),
  probe: CwdInput,
  log: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    branch: v.string(),
    count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    skip: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))),
  }),
  patch: v.object({ cwd: WorkspaceIdSchema, workspaceRuntimeId: WorkspaceRuntimeIdSchema, worktreePath: v.string() }),
  projection: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
    branch: v.optional(v.string()),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
  worktreeStatus: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  }),
  workspaceOverview: v.object({
    cwd: WorkspaceIdSchema,
    workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  }),
  operations: v.object({
    cwd: v.optional(WorkspaceIdSchema),
    workspaceRuntimeId: v.optional(WorkspaceRuntimeIdSchema),
    includeSettled: v.optional(v.boolean()),
  }),
} as const

export const REMOTE_PROCEDURE_SCHEMAS = {
  resolveTarget: RemoteConnectionInputSchema,
  // Starts a server-owned attempt for one workspace-runtime generation and
  // returns its accepted terminal lifecycle projection.
  remoteLifecycle: v.object({
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
    mode: v.optional(v.picklist(['restart', 'ensure'])),
  }),
  pathSuggestions: RemotePathSuggestionsInputSchema,
  testWorkspace: v.object({ target: RemoteWorkspaceTargetSchema }),
} as const

// Schemas for the settings command handlers. Each shape matches the typed
// input contract documented on `handle*` in
// `#/server/modules/settings-write-paths.ts` — the route layer
// validates with these, then passes the parsed object directly to the
// module layer.
const FiletreeSessionViewStateSchema = v.object({
  selectedKeys: v.array(v.string()),
  expandedKeys: v.array(v.string()),
  topVisibleRowIndex: v.number(),
})
const ClientWorkspaceStateSchema = v.object({
  restoredWorkspaceId: v.nullable(WorkspaceIdSchema),
  zenMode: v.boolean(),
  workspacePaneSize: v.number(),
  selectedTerminalSessionIdByTerminalWorktree: v.record(v.string(), v.string()),
  preferredWorkspacePaneTabByTargetByWorkspace: v.record(
    v.string(),
    v.record(v.string(), v.nullable(v.picklist(['status', 'changes', 'history', 'files', 'terminal']))),
  ),
  filetreeViewStateByWorktreeByWorkspace: v.record(v.string(), v.record(v.string(), FiletreeSessionViewStateSchema)),
})

// Shared shape for the GitHub CLI state endpoints (`/api/settings/github-cli`
// and `/api/settings/github-cli/refresh`): both accept an optional `hosts`
// filter so the client can scope detection to specific hostnames.
export const GITHUB_CLI_REFRESH_SCHEMA = v.object({
  hosts: v.optional(StringArray),
})

export const SETTINGS_PROCEDURE_SCHEMAS = {
  fetchInterval: v.object({ sec: v.number() }),
  globalShortcutState: v.object({ registered: v.boolean() }),
  recentWorkspacesAdd: v.object({ workspace: WorkspaceSessionEntrySchema }),
  // Body for `POST /api/settings/workspace-external-app-recent`. The
  // server-side mutator still re-validates workspaceId, worktreePath and
  // itemId, including path and NUL checks, before touching disk; this
  // schema only enforces the basic wire shape.
  workspaceExternalAppRecentSet: v.object({
    workspaceId: WorkspaceIdSchema,
    worktreePath: v.nullable(v.pipe(v.string(), v.minLength(1))),
    itemId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  }),
  githubCli: GITHUB_CLI_REFRESH_SCHEMA,
  workspaceRestore: v.object({
    clientId: ClientIdSchema,
    activeWorkspaceId: v.optional(v.nullable(WorkspaceIdSchema)),
  }),
  workspaceEntryAdd: v.object({ entry: WorkspaceSessionEntrySchema }),
  workspaceEntryRemove: v.object({ workspaceId: WorkspaceIdSchema }),
  // Lazily projects a non-active workspace that was hydrated as a stub.
  restoreWorkspaceTabs: v.object({
    clientId: ClientIdSchema,
    workspaceId: WorkspaceIdSchema,
    workspaceRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
  }),
} as const

// `prefs` accepts a permissive patch — the underlying
// `updateUserSettings` does field-level validation (and
// ignores unknown keys), so we only enforce that the body is an
// object at the perimeter.
export const SETTINGS_PATCH_SCHEMAS = {
  prefs: v.object({ prefs: v.record(v.string(), v.unknown()) }),
} as const

// Native host IPC procedures — Electron-only operations that bypass
// the HTTP server entirely. Handlers live in `main/native-host-ipc-router.ts`.
export const NATIVE_HOST_IPC_PROCEDURE_SCHEMAS = {
  clientWorkspace: {
    read: v.undefined(),
    write: ClientWorkspaceStateSchema,
  },
  settings: {
    setGlobalShortcut: v.object({ accelerator: v.string() }),
    applyNativeHostProjection: NativeHostProjectionSchema,
  },
} as const
