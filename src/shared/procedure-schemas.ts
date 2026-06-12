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

const SourceToken = v.optional(v.string())
const StringArray = v.array(v.string())

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
  checkout: v.object({ cwd: v.string(), branch: v.string(), sourceToken: SourceToken }),
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
    newBranch: v.string(),
    baseBranch: v.string(),
    sourceToken: SourceToken,
  }),
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
  pathSuggestions: RemotePathSuggestionsInputSchema,
  testRepository: v.object({ target: RemoteTargetSchema }),
} as const

// Query-string schemas for the GET repo read endpoints. `parseHttpQuery`
// flattens the URLSearchParams into a `{ key: string | string[] }` object
// before validating, so multi-value keys (e.g. `branches`) accept arrays.
export const REPO_QUERY_SCHEMAS = {
  probe: v.object({ cwd: v.string() }),
  snapshot: v.object({ cwd: v.string() }),
  status: v.object({ cwd: v.string() }),
  patch: v.object({ cwd: v.string(), worktreePath: v.string() }),
  pullRequests: v.object({
    cwd: v.string(),
    branches: v.optional(v.array(v.string())),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
  // Composite read — picks which sub-reads to fold into one round trip.
  composite: v.object({
    cwd: v.string(),
    include: v.optional(v.array(v.picklist(['snapshot', 'status', 'pullRequests']))),
    branches: v.optional(v.array(v.string())),
    mode: v.optional(v.picklist(['summary', 'full'])),
  }),
} as const

// Settings writes are routed to `applyServer*Write` helpers that already do
// deep validation; we only enforce that the body is a JSON object so a
// missing/garbled payload is rejected at the perimeter.
export const SETTINGS_PROCEDURE_SCHEMAS = {
  fetchInterval: v.object({ sec: v.number() }),
  globalShortcutState: v.object({ registered: v.boolean() }),
  recentReposAdd: v.object({ repo: v.record(v.string(), v.unknown()) }),
} as const

// Schemas whose body is a permissive object — used where the underlying
// write-path accepts a loose patch and validates fields internally.
export const SETTINGS_PATCH_SCHEMAS = {
  prefs: v.object({ settings: v.record(v.string(), v.unknown()) }),
  session: v.object({ session: v.record(v.string(), v.unknown()) }),
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
