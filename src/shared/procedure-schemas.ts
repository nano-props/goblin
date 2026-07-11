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
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES, WORKSPACE_PANE_STATIC_TAB_IDS } from '#/shared/workspace-pane.ts'
import { NativeHostProjectionSchema } from '#/shared/native-host-projection.ts'
import { RepoTreePrefixSchema } from '#/shared/repo-tree-schema.ts'
import { GIT_HASH_RE } from '#/shared/git-types.ts'
import { WORKTREE_BOOTSTRAP_CONFIG_HASH_RE } from '#/shared/repo-settings.ts'
import { OPAQUE_ID_RE } from '#/shared/opaque-id.ts'

const StringArray = v.array(v.string())
const TerminalAppSchema = v.picklist(['ghostty', 'terminal', 'windowsTerminal'])
const EditorAppSchema = v.picklist(['vscode'])
const WorktreeBootstrapConfigHashSchema = v.pipe(v.string(), v.regex(WORKTREE_BOOTSTRAP_CONFIG_HASH_RE))
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
  id: v.string(),
  alias: v.string(),
  remotePath: v.string(),
  displayName: v.string(),
})

const RepoSessionEntrySchema = v.variant('kind', [
  v.object({ kind: v.literal('local'), id: v.string() }),
  v.object({ kind: v.literal('remote'), id: v.string(), ref: RemoteRepoRefSchema }),
])
const RepoRuntimeOpenSchema = v.union([v.object({ repoRoot: v.string() }), v.object({ repoInput: v.string() })])
const RepoRuntimeCloseSchema = v.object({
  repoRoot: v.string(),
  repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
})
const EmptyBodySchema = v.optional(v.object({}))

export const REPO_PROCEDURE_SCHEMAS = {
  // Action endpoints — POST with a JSON body.
  fetch: v.strictObject({
    cwd: v.string(),
  }),
  clone: v.object({
    url: v.string(),
    parentPath: v.string(),
    directoryName: v.string(),
  }),
  pull: v.object({
    cwd: v.string(),
    branch: v.string(),
    worktreePath: v.optional(v.string()),
  }),
  push: v.object({ cwd: v.string(), branch: v.string() }),
  createWorktree: v.object({
    cwd: v.string(),
    worktreePath: v.string(),
    mode: v.variant('kind', [
      v.object({ kind: v.literal('newBranch'), newBranch: v.string(), baseRef: v.string() }),
      v.object({ kind: v.literal('existingBranch'), branch: v.string() }),
      v.object({ kind: v.literal('trackRemoteBranch'), remoteRef: v.string(), localBranch: v.string() }),
    ]),
    worktreeBootstrap: WorktreeBootstrapDecisionSchema,
  }),
  getRemoteBranches: CwdInput,
  worktreeBootstrapPreview: CwdInput,
  deleteBranch: v.object({
    cwd: v.string(),
    branch: v.string(),
    force: v.optional(v.boolean()),
    alsoDeleteUpstream: v.optional(v.boolean()),
  }),
  removeWorktree: v.object({
    cwd: v.string(),
    repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
    branch: v.string(),
    worktreePath: v.string(),
    alsoDeleteBranch: v.boolean(),
    forceDeleteBranch: v.optional(v.boolean()),
    alsoDeleteUpstream: v.optional(v.boolean()),
  }),
  openUrl: v.object({ cwd: v.string(), target: RepoUrlTargetSchema }),
  openTerminal: v.object({ path: v.string(), app: TerminalAppSchema }),
  openEditor: v.object({ path: v.string(), app: EditorAppSchema }),
  openInFinder: v.object({ path: v.string() }),
  backgroundSyncRepos: v.object({ repoIds: StringArray }),
  runtimeOpen: RepoRuntimeOpenSchema,
  runtimeList: EmptyBodySchema,
  runtimeClose: RepoRuntimeCloseSchema,
  abort: CwdInput,
  probe: CwdInput,
  log: v.object({
    cwd: v.string(),
    branch: v.string(),
    count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    skip: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000))),
  }),
  patch: v.object({ cwd: v.string(), worktreePath: v.string() }),
  // Worktree-scoped file tree (docs/filetree.md). The route returns
  // direct children of `prefix`; omitted prefix means the worktree root.
  // The perimeter rejects absolute paths, `..` segments, control
  // characters and backslashes inside `prefix`, and the read layer
  // still verifies `worktreePath` against the worktree list.
  tree: v.object({
    cwd: v.string(),
    worktreePath: v.string(),
    prefix: v.optional(RepoTreePrefixSchema),
  }),
  trashFile: v.object({
    cwd: v.string(),
    worktreePath: v.string(),
    path: RepoTreePrefixSchema,
  }),
  fileViewer: v.object({
    cwd: v.string(),
    worktreePath: v.string(),
  }),
  projection: v.object({
    cwd: v.string(),
    repoRuntimeId: v.optional(v.pipe(v.string(), v.regex(OPAQUE_ID_RE))),
    branch: v.optional(v.string()),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
  operations: v.object({
    cwd: v.optional(v.string()),
    includeSettled: v.optional(v.boolean()),
  }),
} as const

export const REMOTE_PROCEDURE_SCHEMAS = {
  resolveTarget: RemoteConnectionInputSchema,
  // Starts a server-owned attempt for one repo-runtime generation and
  // returns its accepted terminal lifecycle projection.
  remoteLifecycle: v.object({
    repoId: v.string(),
    repoRuntimeId: v.pipe(v.string(), v.regex(OPAQUE_ID_RE)),
  }),
  pathSuggestions: RemotePathSuggestionsInputSchema,
  testRepo: v.object({ target: RemoteTargetSchema }),
  openEditor: v.object({ repoId: v.string(), worktreePath: v.string(), app: EditorAppSchema }),
  openTerminal: v.object({ repoId: v.string(), worktreePath: v.string(), app: TerminalAppSchema }),
} as const

// Schemas for the settings command handlers. Each shape matches the typed
// input contract documented on `handle*` in
// `#/server/modules/settings-write-paths.ts` — the route layer
// validates with these, then passes the parsed object directly to the
// module layer.
const WorkspacePaneStaticTabEntrySchema = v.variant('type', [
  v.object({ type: v.literal('status'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.status) }),
  v.object({ type: v.literal('changes'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.changes) }),
  v.object({ type: v.literal('history'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.history) }),
  v.object({ type: v.literal('files'), tabId: v.literal(WORKSPACE_PANE_STATIC_TAB_IDS.files) }),
])
const WorkspacePaneRuntimeTabEntrySchema = v.object({
  type: v.picklist(WORKSPACE_PANE_RUNTIME_TAB_TYPES),
  runtimeSessionId: v.pipe(v.string(), v.minLength(1)),
})
const FiletreeSessionViewStateSchema = v.object({
  selectedKeys: v.array(v.string()),
  expandedKeys: v.array(v.string()),
  topVisibleRowIndex: v.number(),
})
const WorkspaceSessionStateSchema = v.object({
  openRepoEntries: v.array(RepoSessionEntrySchema),
  restoredRepoId: v.nullable(v.string()),
  zenMode: v.boolean(),
  workspacePaneSize: v.number(),
  selectedTerminalSessionIdByTerminalWorktree: v.record(v.string(), v.string()),
  preferredWorkspacePaneTabByTargetByRepo: v.record(
    v.string(),
    v.record(v.string(), v.nullable(v.picklist(['status', 'changes', 'history', 'files', 'terminal']))),
  ),
  workspacePaneTabsByTargetByRepo: v.record(
    v.string(),
    v.record(v.string(), v.array(v.union([WorkspacePaneStaticTabEntrySchema, WorkspacePaneRuntimeTabEntrySchema]))),
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
  recentReposAdd: v.object({ repo: RepoSessionEntrySchema }),
  // Body for `POST /api/settings/repo-external-app-recent`. The
  // server-side mutator still re-validates repoId, worktreePath and
  // itemId, including path and NUL checks, before touching disk; this
  // schema only enforces the basic wire shape.
  repoExternalAppRecentSet: v.object({
    repoId: v.pipe(v.string(), v.minLength(1)),
    worktreePath: v.nullable(v.pipe(v.string(), v.minLength(1))),
    itemId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  }),
  githubCli: GITHUB_CLI_REFRESH_SCHEMA,
} as const

// `prefs` accepts a permissive patch — the underlying
// `updateUserSettings` does field-level validation (and
// ignores unknown keys), so we only enforce that the body is an
// object at the perimeter.
export const SETTINGS_PATCH_SCHEMAS = {
  prefs: v.object({ prefs: v.record(v.string(), v.unknown()) }),
  session: v.object({ session: WorkspaceSessionStateSchema }),
} as const

// Native host IPC procedures — Electron-only operations that bypass
// the HTTP server entirely. Handlers live in `main/native-host-ipc-router.ts`.
export const NATIVE_HOST_IPC_PROCEDURE_SCHEMAS = {
  settings: {
    setGlobalShortcut: v.object({ accelerator: v.string() }),
    applyNativeHostProjection: NativeHostProjectionSchema,
  },
} as const
