import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

export type RepoBranchAction =
  | { kind: 'pull'; branch: string; worktreePath?: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createWorktree'; input: CreateWorktreeInput; worktreeBootstrap: WorktreeBootstrapDecision }
  | { kind: 'deleteBranch'; branch: string; force?: boolean; deleteUpstream?: boolean }
  | {
      kind: 'removeWorktree'
      branch: string
      worktreePath: string
      deleteBranch: boolean
      forceDeleteBranch?: boolean
      deleteUpstream?: boolean
    }

export type RepoBranchActionKind = RepoBranchAction['kind']

export interface RunBranchActionOptions {
  workspaceRuntimeId?: string
  deferResultMessages?: string[]
  refreshOnError?: boolean
  /** Internal override for tests that exercise queued refresh wait timeouts. */
  waitTimeoutMs?: number
}
