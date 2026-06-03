// Renderer-facing git domain types. Re-exports from the shared module
// so adding a field on the main side reaches the renderer without a
// manual mirror copy.

export type {
  BranchSnapshotInfo,
  GitRemoteInfo,
  StatusEntry,
  WorktreeStatus,
  LogEntry,
  ExecResult,
  PullRequestInfo,
  PullRequestFetchMode,
  BrowserRemoteProvider,
} from '#/shared/git-types.ts'
