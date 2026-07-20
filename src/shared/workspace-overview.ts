export interface WorkspaceDirectoryOverview {
  readonly topLevelFileCount: number
  readonly topLevelDirectoryCount: number
  /** Best-effort recursive file size. `null` when any descendant could not be inspected. */
  readonly totalSizeBytes: number | null
}
