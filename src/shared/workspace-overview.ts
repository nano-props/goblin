export interface WorkspaceDirectoryOverview {
  readonly topLevelFileCount: number
  readonly topLevelDirectoryCount: number
  /** Workspace directory mtime, following a symbolic-link workspace path; not the newest descendant. */
  readonly lastModifiedAt: string
}
