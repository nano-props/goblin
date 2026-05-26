import { runExclusiveOperation, type RepoOperationTarget } from '#/renderer/stores/repos/operation-runner.ts'
import type { RepoBranchActionReason, RepoOperationReason } from '#/renderer/stores/repos/operations.ts'
import { updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { repoOperationBusy } from '#/renderer/stores/repos/runtime.ts'
import {
  cancelResource,
  finishBranchActionResourceError,
  finishBranchActionResourceSuccess,
  finishResourceError,
  finishResourceSuccess,
  resourceBusy,
  startBranchActionResource,
  startResource,
} from '#/renderer/stores/repos/resources.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import type {
  RepoBranchAction,
  RepoBranchActionKind,
  RunBranchActionOptions,
} from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoEventAction, RepoState, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { ExecResult } from '#/renderer/types.ts'
import { runBranchActionRefreshWorkflow } from '#/renderer/stores/repos/refresh-workflows.ts'
import { rpc } from '#/renderer/rpc.ts'

const NETWORK_BRANCH_ACTIONS = new Set<RepoBranchActionKind>(['pull', 'push'])
const BRANCH_ACTION_REASON_BY_KIND: Record<RepoBranchActionKind, RepoBranchActionReason> = {
  checkout: 'branch:checkout',
  pull: 'branch:pull',
  push: 'branch:push',
  createWorktree: 'branch:createWorktree',
  deleteBranch: 'branch:deleteBranch',
  removeWorktree: 'branch:removeWorktree',
}
type NetworkRepoBranchAction = Extract<RepoBranchAction, { kind: 'pull' | 'push' }>
type NetworkFetchReason = Extract<RepoOperationReason, 'pull' | 'push'>
const NETWORK_FETCH_REASON_BY_KIND: Record<NetworkRepoBranchAction['kind'], NetworkFetchReason> = {
  pull: 'pull',
  push: 'push',
}

export function repoBranchActionReason(kind: RepoBranchActionKind): RepoBranchActionReason {
  return BRANCH_ACTION_REASON_BY_KIND[kind]
}

function branchActionReason(action: RepoBranchAction): RepoBranchActionReason {
  return repoBranchActionReason(action.kind)
}

function branchActionOperationTarget(action: RepoBranchAction): string | null {
  switch (action.kind) {
    case 'checkout':
    case 'pull':
    case 'push':
    case 'deleteBranch':
    case 'removeWorktree':
      return action.branch
    case 'createWorktree':
      return action.newBranch
  }
  const exhaustive: never = action
  return exhaustive
}

function branchActionEventAction(action: RepoBranchAction): RepoEventAction {
  switch (action.kind) {
    case 'checkout':
    case 'pull':
    case 'push':
    case 'deleteBranch':
      return { kind: action.kind, branch: action.branch }
    case 'createWorktree':
      return { kind: action.kind, branch: action.newBranch, worktreePath: action.worktreePath }
    case 'removeWorktree':
      return {
        kind: action.kind,
        branch: action.branch,
        worktreePath: action.worktreePath,
        alsoDeleteBranch: action.alsoDeleteBranch,
      }
  }
  const exhaustive: never = action
  return exhaustive
}

function networkFetchReason(action: NetworkRepoBranchAction): NetworkFetchReason {
  return NETWORK_FETCH_REASON_BY_KIND[action.kind]
}

function isNetworkBranchAction(action: RepoBranchAction): action is NetworkRepoBranchAction {
  return NETWORK_BRANCH_ACTIONS.has(action.kind)
}

function branchActionTarget(action: RepoBranchAction): RepoOperationTarget {
  return {
    key: 'branchAction',
    reason: branchActionReason(action),
    target: branchActionOperationTarget(action),
  }
}

function canStartBranchNetwork(repo: RepoState): boolean {
  return canStartRemoteFetch(repo)
}

function focusCreatedWorktreeBranch(get: ReposGet, id: string, token: number, action: RepoBranchAction): void {
  if (action.kind !== 'createWorktree') return
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token) return
  if (!repo.data.branches.some((branch) => branch.name === action.newBranch)) return
  if (repo.ui.branchViewMode === 'no-worktree') get().setBranchViewMode(id, 'all')
  get().selectBranch(id, action.newBranch)
}

function runBranchActionRpc(action: RepoBranchAction, repoId: string, signal?: AbortSignal): Promise<ExecResult> {
  switch (action.kind) {
    case 'checkout':
      return rpc.repo.checkout.mutate({ cwd: repoId, branch: action.branch }, { signal })
    case 'pull':
      return rpc.repo.pull.mutate({ cwd: repoId, branch: action.branch, worktreePath: action.worktreePath }, { signal })
    case 'push':
      return rpc.repo.push.mutate({ cwd: repoId, branch: action.branch }, { signal })
    case 'createWorktree':
      return rpc.repo.createWorktree.mutate(
        {
          cwd: repoId,
          worktreePath: action.worktreePath,
          newBranch: action.newBranch,
          baseBranch: action.baseBranch,
        },
        { signal },
      )
    case 'deleteBranch':
      return rpc.repo.deleteBranch.mutate({ cwd: repoId, branch: action.branch, force: action.force }, { signal })
    case 'removeWorktree':
      return rpc.repo.removeWorktree.mutate(
        {
          cwd: repoId,
          branch: action.branch,
          worktreePath: action.worktreePath,
          alsoDeleteBranch: action.alsoDeleteBranch,
          forceDeleteBranch: action.forceDeleteBranch,
        },
        { signal },
      )
  }
  const exhaustive: never = action
  return exhaustive
}

export function createBranchActions(set: ReposSet, get: ReposGet) {
  return {
    async runBranchAction(
      id: string,
      action: RepoBranchAction,
      options?: RunBranchActionOptions,
    ): Promise<ExecResult | null> {
      const repoBefore = get().repos[id]
      if (!repoBefore) return null
      const token = options?.token ?? repoBefore.instanceToken
      if (repoBefore.instanceToken !== token) return null
      if (resourceBusy(repoBefore.resources.branchAction) || repoOperationBusy(id, 'branchAction')) {
        return { ok: false, message: 'cancelled' }
      }
      const network = isNetworkBranchAction(action)
      if (!canStartBranchNetwork(repoBefore)) {
        const result = { ok: false, message: 'error.network-op-in-progress' }
        get().setLastResult(id, result, token)
        return result
      }
      updateIfFresh(set, id, token, (r) => {
        startBranchActionResource(r.resources.branchAction, action.kind, branchActionOperationTarget(action))
        if (network) startResource(r.resources.fetch, { hasData: r.resources.fetch.loadedAt !== null })
      })
      return runExclusiveOperation({
        get,
        id,
        token,
        lane: network ? 'network' : 'write',
        priority: 100,
        targets: network
          ? [branchActionTarget(action), { key: 'fetch', reason: networkFetchReason(action) }]
          : [branchActionTarget(action)],
        busyResult: network
          ? { ok: false, message: 'error.network-op-in-progress' }
          : { ok: false, message: 'cancelled' },
        task: (signal) => runBranchActionRpc(action, id, signal),
        errorFromResult: (result) => (!result.ok && result.message !== 'cancelled' ? result.message : null),
        onResult: async (result) => {
          updateIfFresh(set, id, token, (r) => {
            if (result.message === 'cancelled') {
              finishBranchActionResourceSuccess(r.resources.branchAction)
              if (network) cancelResource(r.resources.fetch)
            } else if (result.ok) {
              finishBranchActionResourceSuccess(r.resources.branchAction)
              if (network) finishResourceSuccess(r.resources.fetch)
            } else {
              finishBranchActionResourceError(r.resources.branchAction, result.message)
              if (network) finishResourceError(r.resources.fetch, result.message)
            }
          })
          if (result.message === 'cancelled') return
          if (options?.deferResultMessages?.includes(result.message)) return
          get().setLastResult(id, result, token, { action: branchActionEventAction(action) })
          if (!result.ok && result.message === 'error.network-op-in-progress') return
          if (result.ok || options?.refreshOnError !== false) {
            const repo = get().repos[id]
            if (repo?.instanceToken === token) await runBranchActionRefreshWorkflow(get, { id, token })
            if (result.ok) focusCreatedWorktreeBranch(get, id, token, action)
          }
          if (result.ok && network) get().clearFetchFailed(id, token)
        },
        onError: (message) => {
          updateIfFresh(set, id, token, (r) => {
            finishBranchActionResourceError(r.resources.branchAction, message)
            if (network) finishResourceError(r.resources.fetch, message)
          })
          get().setLastResult(id, { ok: false, message }, token, { action: branchActionEventAction(action) })
        },
      })
    },
  }
}
