import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneLayoutRepositorySnapshot } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspacePaneLayoutRestoreTransactionOutcome =
  | { kind: 'accepted'; snapshot: WorkspacePaneLayoutRepositorySnapshot }
  | { kind: 'membership-conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }

export interface WorkspacePaneLayoutRestoreTransaction {
  validateMembershipAndLoad(input: {
    workspaceId: WorkspaceId
    expectedWorkspaceEntry: WorkspaceSessionEntry
  }): Promise<WorkspacePaneLayoutRestoreTransactionOutcome>
}
