// Procedure input schemas shared between the HTTP route layer and the
// native bridge IPC layer. Each transport validates payloads with
// `parseHttpInput` (see `#/server/common/http-validate.ts`) or
// `parseIpcInput` (see `#/shared/api-types.ts`) using the schemas
// declared here, so the request contract is defined once.
//
// Primitive reusable schemas (CwdInput, BranchInput, Remote*Schema)
// live in `#/shared/api-types.ts` next to the IPC types they describe.

import * as v from 'valibot'
import {
  CwdInput,
  RemoteConnectionInputSchema,
  RemotePathSuggestionsInputSchema,
  RemoteTargetSchema,
} from '#/shared/api-types.ts'
import { NativeHostProjectionSchema } from '#/shared/native-host-projection.ts'
import { RepoTreePrefixSchema } from '#/shared/repo-tree-schema.ts'
import { GIT_HASH_RE } from '#/shared/git-types.ts'
import { WORKTREE_BOOTSTRAP_CONFIG_HASH_RE } from '#/shared/repo-settings.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'

const StringArray = v.array(v.string())
const TerminalAppSchema = v.picklist(['ghostty', 'terminal', 'windowsTerminal'])
const EditorAppSchema = v.picklist(['vscode'])
const WorktreeBootstrapConfigHashSchema = v.pipe(v.string(), v.regex(WORKTREE_BOOTSTRAP_CONFIG_HASH_RE))
const RepoRuntimeIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
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

const RemoteRepoRefSchema = v.object({
  id: WorkspaceIdSchema,
  alias: v.string(),
  remotePath: v.string(),
  displayName: v.string(),
})

const WorkspaceSessionEntrySchema = v.variant('kind', [
  v.object({ kind: v.literal('local'), id: WorkspaceIdSchema }),
  v.object({ kind: v.literal('remote'), id: WorkspaceIdSchema, ref: RemoteRepoRefSchema }),
])
const ClientIdSchema = v.pipe(v.string(), v.regex(OPAQUE_ID_RE))
const RepoRootSchema = WorkspaceIdSchema
const RepoRuntimeOpenSchema = v.union([
  v.object({ repoRoot: RepoRootSchema, clientId: ClientIdSchema }),
  v.object({ repoInput: v.string(), clientId: ClientIdSchema }),
])
const RepoRuntimeCloseSchema = v.object({
  repoRoot: RepoRootSchema,
  repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
  clientId: ClientIdSchema,
})
const EmptyBodySchema = v.optional(v.object({}))

export const REPO_PROCEDURE_SCHEMAS = {
  // Action endpoints — POST with a JSON body.
  workspaceRefresh: v.object({
    workspaceId: RepoRootSchema,
    workspaceRuntimeId: RepoRuntimeIdSchema,
  }),
  fetch: v.strictObject({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
  }),
  clone: v.object({
    url: v.string(),
    parentPath: v.string(),
    directoryName: v.string(),
  }),
  pull: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    branch: v.string(),
    worktreePath: v.optional(v.string()),
  }),
  push: v.object({ cwd: WorkspaceIdSchema, repoRuntimeId: RepoRuntimeIdSchema, branch: v.string() }),
  createWorktree: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
    mode: v.variant('kind', [
      v.object({ kind: v.literal('newBranch'), newBranch: v.string(), baseRef: v.string() }),
      v.object({ kind: v.literal('existingBranch'), branch: v.string() }),
      v.object({ kind: v.literal('trackRemoteBranch'), remoteRef: v.string(), localBranch: v.string() }),
    ]),
    worktreeBootstrap: WorktreeBootstrapDecisionSchema,
  }),
  getRemoteBranches: v.object({ cwd: WorkspaceIdSchema, repoRuntimeId: RepoRuntimeIdSchema }),
  worktreeBootstrapPreview: v.object({ cwd: WorkspaceIdSchema, repoRuntimeId: RepoRuntimeIdSchema }),
  deleteBranch: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    branch: v.string(),
    force: v.optional(v.boolean()),
    deleteUpstream: v.optional(v.boolean()),
  }),
  removeWorktree: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    branch: v.string(),
    worktreePath: v.string(),
    deleteBranch: v.boolean(),
    forceDeleteBranch: v.optional(v.boolean()),
    deleteUpstream: v.optional(v.boolean()),
  }),
  openUrl: v.object({ cwd: WorkspaceIdSchema, repoRuntimeId: RepoRuntimeIdSchema, target: RepoUrlTargetSchema }),
  openTerminal: v.object({
    repoId: RepoRootSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
    app: TerminalAppSchema,
  }),
  openEditor: v.object({
    repoId: RepoRootSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
    app: EditorAppSchema,
  }),
  openInFinder: v.object({
    repoId: RepoRootSchema,
    worktreePath: v.string(),
  }),
  backgroundSyncRepos: v.object({ repoIds: StringArray }),
  runtimeOpen: RepoRuntimeOpenSchema,
  runtimeReconcile: v.object({
    clientId: ClientIdSchema,
    repoRoots: v.pipe(v.array(RepoRootSchema), v.maxLength(100)),
  }),
  runtimeList: EmptyBodySchema,
  runtimeClose: RepoRuntimeCloseSchema,
  abort: CwdInput,
  probe: CwdInput,
  log: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    branch: v.string(),
    count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    skip: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))),
  }),
  patch: v.object({ cwd: WorkspaceIdSchema, repoRuntimeId: RepoRuntimeIdSchema, worktreePath: v.string() }),
  // Worktree-scoped file tree (docs/filetree.md). The route returns
  // direct children of `prefix`; omitted prefix means the worktree root.
  // The perimeter rejects absolute paths, `..` segments, control
  // characters and backslashes inside `prefix`, and the read layer
  // still verifies `worktreePath` against the worktree list.
  tree: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
    prefix: v.optional(RepoTreePrefixSchema),
  }),
  trashFile: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
    path: RepoTreePrefixSchema,
  }),
  fileViewer: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    worktreePath: v.string(),
  }),
  projection: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
    branch: v.optional(v.string()),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
  worktreeStatus: v.object({
    cwd: WorkspaceIdSchema,
    repoRuntimeId: RepoRuntimeIdSchema,
  }),
  operations: v.object({
    cwd: v.optional(WorkspaceIdSchema),
    repoRuntimeId: v.optional(RepoRuntimeIdSchema),
    includeSettled: v.optional(v.boolean()),
  }),
} as const

export const REMOTE_PROCEDURE_SCHEMAS = {
  resolveTarget: RemoteConnectionInputSchema,
  // Starts a server-owned attempt for one repo-runtime generation and
  // returns its accepted terminal lifecycle projection.
  remoteLifecycle: v.object({
    repoId: WorkspaceIdSchema,
    repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
    mode: v.optional(v.picklist(['restart', 'ensure'])),
  }),
  pathSuggestions: RemotePathSuggestionsInputSchema,
  testRepo: v.object({ target: RemoteTargetSchema }),
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
  restoredRepoId: v.nullable(v.string()),
  zenMode: v.boolean(),
  workspacePaneSize: v.number(),
  selectedTerminalSessionIdByTerminalWorktree: v.record(v.string(), v.string()),
  preferredWorkspacePaneTabByTargetByRepo: v.record(
    v.string(),
    v.record(v.string(), v.nullable(v.picklist(['status', 'changes', 'history', 'files', 'terminal']))),
  ),
  filetreeViewStateByWorktreeByRepo: v.record(v.string(), v.record(v.string(), FiletreeSessionViewStateSchema)),
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
  recentWorkspacesAdd: v.object({ repo: WorkspaceSessionEntrySchema }),
  // Body for `POST /api/settings/repo-external-app-recent`. The
  // server-side mutator still re-validates repoId, worktreePath and
  // itemId, including path and NUL checks, before touching disk; this
  // schema only enforces the basic wire shape.
  repoExternalAppRecentSet: v.object({
    repoId: WorkspaceIdSchema,
    worktreePath: v.nullable(v.pipe(v.string(), v.minLength(1))),
    itemId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  }),
  githubCli: GITHUB_CLI_REFRESH_SCHEMA,
  workspaceRestore: v.object({
    clientId: ClientIdSchema,
    activeRepoRoot: v.optional(v.nullable(RepoRootSchema)),
  }),
  workspaceRepoAdd: v.object({ entry: WorkspaceSessionEntrySchema }),
  workspaceRepoRemove: v.object({ repoRoot: RepoRootSchema }),
  // Lazy per-repo restore endpoint — fires when the user navigates to a
  // non-active repo that was hydrated as a stub at cold start.
  restoreRepoTabs: v.object({
    clientId: ClientIdSchema,
    repoRoot: RepoRootSchema,
    repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
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
