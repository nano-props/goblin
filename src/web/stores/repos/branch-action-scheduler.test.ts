import { describe, expect, test } from 'vitest'
import { evaluateBranchActionSchedule, isNetworkBranchActionKind } from '#/web/stores/repos/branch-action-scheduler.ts'
import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationPhase } from '#/web/stores/repos/operations.ts'
const ACTIONS: RepoBranchActionKind[] = ['pull', 'push', 'createWorktree', 'deleteBranch', 'removeWorktree']

function decision(input: {
  actionKind: RepoBranchActionKind
  fetchBusy?: boolean
  branchOperationPhase?: RepoOperationPhase
  coreRefreshBusy?: boolean
}) {
  return evaluateBranchActionSchedule({
    fetchBusy: false,
    branchOperationPhase: 'idle',
    coreRefreshBusy: false,
    ...input,
  })
}

describe('isNetworkBranchActionKind', () => {
  test('identifies pull and push as network branch actions', () => {
    expect(ACTIONS.filter(isNetworkBranchActionKind)).toEqual(['pull', 'push'])
  })
})

describe('evaluateBranchActionSchedule', () => {
  test.each(ACTIONS)('runs %s immediately when no blocking work exists', (actionKind) => {
    expect(decision({ actionKind })).toEqual({})
  })

  test.each(ACTIONS)('blocks %s behind foreground fetch work', (actionKind) => {
    expect(
      decision({
        actionKind,
        fetchBusy: true,
      }),
    ).toEqual({
      blockedMessage: 'error.network-op-in-progress',
    })
  })

  test.each(ACTIONS)('queues %s behind core refresh work', (actionKind) => {
    expect(decision({ actionKind, coreRefreshBusy: true })).toEqual({})
  })
})
