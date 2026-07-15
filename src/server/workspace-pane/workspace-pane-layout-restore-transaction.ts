import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneLayoutRepositorySnapshot } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'

export type WorkspacePaneLayoutRestoreTransactionOutcome =
  | { kind: 'accepted'; snapshot: WorkspacePaneLayoutRepositorySnapshot; changed: boolean }
  | { kind: 'membership-conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }
  | { kind: 'write-failure'; error: unknown; snapshot: WorkspacePaneLayoutRepositorySnapshot }

export interface WorkspacePaneLayoutRestoreTransaction {
  validateMembershipAndRepair(
    input: { repoRoot: string; expectedRepoEntry: RepoSessionEntry; validTargetKeys: readonly string[] },
  ): Promise<WorkspacePaneLayoutRestoreTransactionOutcome>
}
