// Renderer-facing git domain types. Re-exports from the shared module
// so adding a field on the main side reaches the renderer without a
// manual mirror copy.

export type {
  BranchInfo,
  StatusEntry,
  WorktreeStatus,
  LogEntry,
  ExecResult,
  PullRequestInfo,
  PullRequestFetchMode,
} from '#/shared/git-types.ts'
