// HTTP procedure input schemas. Routes call `parseHttpInput` (see
// `#/server/common/http-validate.ts`) with one of these to validate the
// JSON body before delegating to the application layer.
//
// Schemas are kept colocated here so the route file only contains wiring,
// and so the renderer (which already shares `api-types.ts` with the IPC
// layer) can read the same shapes when it adopts valibot parsers.

import * as v from 'valibot'
import {
  CwdInput,
  BranchInput,
  RemoteConnectionInputSchema,
  RemotePathSuggestionsInputSchema,
  RemoteTargetSchema,
} from '#/shared/api-types.ts'

const SourceToken = v.optional(v.string())
const StringArray = v.array(v.string())

export const REPO_PROCEDURE_SCHEMAS = {
  probe: CwdInput,
  snapshot: CwdInput,
  status: CwdInput,
  patch: v.object({ cwd: v.string(), worktreePath: v.string() }),
  pullRequests: v.object({
    cwd: v.string(),
    branches: v.optional(StringArray),
    options: v.optional(v.object({ mode: v.optional(v.picklist(['summary', 'full'])) })),
  }),
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
