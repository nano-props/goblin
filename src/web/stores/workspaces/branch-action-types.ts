import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

export type CreateWorktreeAction = {
  kind: 'createWorktree'
  input: CreateWorktreeInput
  worktreeBootstrap: WorktreeBootstrapDecision
}

export type RepoBranchAction =
  | { kind: 'pull'; branch: string; worktreePath?: string }
  | { kind: 'push'; branch: string }
  | CreateWorktreeAction
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
export type NonCreateRepoBranchAction = Exclude<RepoBranchAction, CreateWorktreeAction>

export interface RunBranchActionOptions {
  workspaceRuntimeId?: string
  deferResultMessages?: string[]
  /** Internal override for tests that exercise queued refresh wait timeouts. */
  waitTimeoutMs?: number
}
