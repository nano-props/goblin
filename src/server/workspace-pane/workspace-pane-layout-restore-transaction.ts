import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneLayoutRepositorySnapshot } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'

export type WorkspacePaneLayoutRestoreTransactionOutcome =
  | { kind: 'accepted'; snapshot: WorkspacePaneLayoutRepositorySnapshot }
  | { kind: 'membership-conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }

export interface WorkspacePaneLayoutRestoreTransaction {
  validateMembershipAndLoad(
    input: { repoRoot: string; expectedRepoEntry: WorkspaceSessionEntry },
  ): Promise<WorkspacePaneLayoutRestoreTransactionOutcome>
}
