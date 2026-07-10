import type { ExecResult } from '#/shared/git-types.ts'

export interface RepoWorktreeRemovalLifecycle {
  beforeRemove(): Promise<ExecResult>
  afterWorktreeRemoved(): Promise<ExecResult>
  afterRemoveFailed(): Promise<void>
}
