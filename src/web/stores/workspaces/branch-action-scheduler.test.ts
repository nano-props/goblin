import { describe, expect, test } from 'vitest'
import { evaluateBranchActionSchedule, isNetworkBranchActionKind } from '#/web/stores/workspaces/branch-action-scheduler.ts'
import type { RepoBranchActionKind } from '#/web/stores/workspaces/branch-action-types.ts'
import type { RepoOperationPhase } from '#/web/stores/workspaces/operations.ts'
const ACTIONS: RepoBranchActionKind[] = ['pull', 'push', 'createWorktree', 'deleteBranch', 'removeWorktree']

function decision(input: {
  actionKind: RepoBranchActionKind
  fetchBusy?: boolean
  branchOperationPhase?: RepoOperationPhase
  projectionReadBusy?: boolean
}) {
  return evaluateBranchActionSchedule({
    fetchBusy: false,
    branchOperationPhase: 'idle',
    projectionReadBusy: false,
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

  test.each(ACTIONS)('queues %s behind projection read work', (actionKind) => {
    expect(decision({ actionKind, projectionReadBusy: true })).toEqual({})
  })
})
