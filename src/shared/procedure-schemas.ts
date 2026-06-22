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
import { NativeShellProjectionSchema } from '#/shared/native-shell-projection.ts'
import { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'

const SourceToken = v.optional(v.string())
const StringArray = v.array(v.string())

/**
 * Wrap an array schema for query-string parameters so that
 * `parseHttpQuery` can handle both single values (a lone
 * `?branches=main`) and multi-value arrays (`?branches=a&branches=b`)
 * transparently. `parseHttpQuery` collapses `URLSearchParams` entries
 * with a single value into a plain string; without this wrapper the
 * valibot `array()` validator would reject the string.
 *
 * Usage: `branches: v.optional(qArray(v.string()))`
 */
function qArray<TItem extends v.GenericSchema>(item: TItem) {
  return v.pipe(
    v.union([v.array(item), item] as const),
    v.transform((input: unknown) => (Array.isArray(input) ? input : [input])),
  ) as v.GenericSchema<unknown, Array<v.InferOutput<TItem>>>
}

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

export const REPO_PROCEDURE_SCHEMAS = {
  // Action endpoints — POST with a JSON body.
  fetch: v.object({
    cwd: v.string(),
    kind: v.optional(v.picklist(['user', 'background'])),
    sourceToken: SourceToken,
  }),
  clone: v.object({
    operationId: v.string(),
    url: v.string(),
    parentPath: v.string(),
    directoryName: v.string(),
  }),
  abortClone: v.object({ operationId: v.string() }),
  pull: v.object({
    cwd: v.string(),
    branch: v.string(),
    worktreePath: v.optional(v.string()),
    sourceToken: SourceToken,
  }),
  push: v.object({ cwd: v.string(), branch: v.string(), sourceToken: SourceToken }),
  createWorktree: v.object({
    cwd: v.string(),
    worktreePath: v.string(),
    mode: v.variant('kind', [
      v.object({ kind: v.literal('newBranch'), newBranch: v.string(), baseRef: v.string() }),
      v.object({ kind: v.literal('existingBranch'), branch: v.string() }),
      v.object({ kind: v.literal('trackRemoteBranch'), remoteRef: v.string(), localBranch: v.string() }),
    ]),
    sourceToken: SourceToken,
  }),
  getRemoteBranches: CwdInput,
  deleteBranch: v.object({
    cwd: v.string(),
    branch: v.string(),
    force: v.optional(v.boolean()),
    alsoDeleteUpstream: v.optional(v.boolean()),
    sourceToken: SourceToken,
  }),
  removeWorktree: v.object({
    cwd: v.string(),
    branch: v.string(),
    worktreePath: v.string(),
    alsoDeleteBranch: v.boolean(),
    forceDeleteBranch: v.optional(v.boolean()),
    alsoDeleteUpstream: v.optional(v.boolean()),
    sourceToken: SourceToken,
  }),
  openRemote: v.object({ cwd: v.string(), branch: v.optional(v.string()) }),
  openTerminal: v.object({ path: v.string() }),
  openEditor: v.object({ path: v.string() }),
  backgroundSyncRepos: v.object({ repoIds: StringArray }),
  abort: CwdInput,
} as const

export const REMOTE_PROCEDURE_SCHEMAS = {
  resolveTarget: RemoteConnectionInputSchema,
  // Unified lifecycle boundary (docs/.../plan §5): body is the
  // repo id. The server parses the id, resolves the SSH target,
  // probes the remote repo, classifies the failure, and returns
  // a converged `RemoteRepoLifecycleResult`. NEVER returns
  // 'connecting' — that's a renderer projection.
  remoteLifecycle: v.object({ repoId: v.string() }),
  pathSuggestions: RemotePathSuggestionsInputSchema,
  testRepository: v.object({ target: RemoteTargetSchema }),
  openEditor: v.object({ repoId: v.string(), worktreePath: v.string() }),
  openTerminal: v.object({ repoId: v.string(), worktreePath: v.string() }),
} as const

// Query-string schemas for the GET repo read endpoints. `parseHttpQuery`
// flattens the URLSearchParams into a `{ key: string | string[] }` object
// before validating, so multi-value keys (e.g. `branches`) accept arrays.
export const REPO_QUERY_SCHEMAS = {
  probe: v.object({ cwd: v.string() }),
  snapshot: v.object({ cwd: v.string() }),
  status: v.object({ cwd: v.string() }),
  log: v.object({
    cwd: v.string(),
    branch: v.string(),
    count: v.optional(
      v.pipe(
        v.union([v.number(), v.pipe(v.string(), v.transform(Number))]),
        v.integer(),
        v.minValue(1),
        v.maxValue(200),
      ),
    ),
    skip: v.optional(
      v.pipe(
        v.union([v.number(), v.pipe(v.string(), v.transform(Number))]),
        v.integer(),
        v.minValue(0),
        v.maxValue(100_000),
      ),
    ),
  }),
  patch: v.object({ cwd: v.string(), worktreePath: v.string() }),
  pullRequests: v.object({
    cwd: v.string(),
    branches: v.optional(qArray(v.string())),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
  // Composite read — picks which sub-reads to fold into one round trip.
  composite: v.object({
    cwd: v.string(),
    include: v.optional(qArray(v.picklist(['snapshot', 'status', 'pullRequests']))),
    branches: v.optional(qArray(v.string())),
    mode: v.optional(v.picklist(['summary', 'full'])),
    // Per-section timeout in ms; non-integer / non-finite / negative
    // values are clamped on the server side, so the perimeter only
    // has to reject non-numbers. Coerce the query string to a number
    // before validating — `parseHttpQuery` always materialises
    // values as strings.
    timeoutMs: v.optional(
      v.pipe(
        v.union([v.number(), v.pipe(v.string(), v.transform(Number))]),
        v.integer(),
        v.minValue(0),
        v.maxValue(600_000),
      ),
    ),
  }),
} as const

// Schemas for the settings write paths. Each shape matches the typed
// input contract documented on `applyServer*Write` in
// `#/server/modules/settings-write-paths.ts` — the route layer
// validates with these, then passes the parsed object directly to the
// module layer.
const SessionStateSchema = v.object({
  openRepos: v.array(RepoSessionEntrySchema),
  activeRepo: v.nullable(v.string()),
  workspaceFocused: v.boolean(),
  workspacePaneSize: v.number(),
  selectedTerminalByWorktree: v.optional(v.record(v.string(), v.string())),
  workspacePaneViewByBranchByRepo: v.optional(
    v.record(v.string(), v.record(v.string(), v.picklist(['status', 'changes', 'history', 'terminal']))),
  ),
})

export const SETTINGS_PROCEDURE_SCHEMAS = {
  fetchInterval: v.object({ sec: v.number() }),
  globalShortcutState: v.object({ registered: v.boolean() }),
  recentReposAdd: v.object({ repo: RepoSessionEntrySchema }),
} as const

// `prefs` accepts a permissive patch — the underlying
// `updateServerSettingsPrefs` does field-level validation (and
// ignores unknown keys), so we only enforce that the body is an
// object at the perimeter.
export const SETTINGS_PATCH_SCHEMAS = {
  prefs: v.object({ settings: v.record(v.string(), v.unknown()) }),
  session: v.object({ session: SessionStateSchema }),
} as const

export const GITHUB_CLI_REFRESH_SCHEMA = v.object({
  hosts: v.optional(StringArray),
})

// Native bridge IPC procedures — Electron shell operations that bypass
// the HTTP server entirely. Handlers live in `main/ipc.ts`.
export const NATIVE_IPC_PROCEDURE_SCHEMAS = {
  settings: {
    setGlobalShortcut: v.object({ accelerator: v.string() }),
    applyShellProjection: NativeShellProjectionSchema,
  },
} as const
