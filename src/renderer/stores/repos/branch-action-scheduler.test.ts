import { describe, expect, test } from 'vitest'
import {
  evaluateBranchActionSchedule,
  isNetworkBranchActionKind,
} from '#/renderer/stores/repos/branch-action-scheduler.ts'
import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoOperationPhase, RepoOperationReason } from '#/renderer/stores/repos/operations.ts'

const ACTIONS: RepoBranchActionKind[] = ['checkout', 'pull', 'push', 'createWorktree', 'deleteBranch', 'removeWorktree']

function decision(input: {
  actionKind: RepoBranchActionKind
  fetchBusy?: boolean
  fetchOperationPhase?: RepoOperationPhase
  fetchOperationReason?: RepoOperationReason | null
  branchOperationPhase?: RepoOperationPhase
  coreRefreshBusy?: boolean
}) {
  return evaluateBranchActionSchedule({
    fetchBusy: false,
    fetchOperationPhase: 'idle',
    fetchOperationReason: null,
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
    expect(decision({ actionKind })).toEqual({
      shouldAbortBackgroundFetch: false,
      waitForBackgroundFetch: false,
    })
  })

  test.each(ACTIONS)('blocks %s behind foreground fetch work', (actionKind) => {
    expect(
      decision({
        actionKind,
        fetchBusy: true,
        fetchOperationPhase: 'running',
        fetchOperationReason: 'user-fetch',
      }),
    ).toMatchObject({
      blockedMessage: 'error.network-op-in-progress',
      shouldAbortBackgroundFetch: false,
      waitForBackgroundFetch: false,
    })
  })

  test.each(ACTIONS)('queues %s behind core refresh work', (actionKind) => {
    expect(decision({ actionKind, coreRefreshBusy: true })).toMatchObject({
      shouldAbortBackgroundFetch: false,
      waitForBackgroundFetch: false,
    })
  })

  test.each(ACTIONS)('aborts background fetch before %s', (actionKind) => {
    expect(
      decision({
        actionKind,
        fetchBusy: true,
        fetchOperationPhase: 'running',
        fetchOperationReason: 'background-fetch',
      }),
    ).toMatchObject({
      shouldAbortBackgroundFetch: true,
      waitForBackgroundFetch: !isNetworkBranchActionKind(actionKind),
    })
  })

  test.each(['pull', 'push'] satisfies RepoBranchActionKind[])(
    'lets queued network action %s replace existing queued network work',
    (actionKind) => {
      expect(
        decision({
          actionKind,
          fetchBusy: true,
          fetchOperationPhase: 'running',
          fetchOperationReason: 'background-fetch',
          branchOperationPhase: 'queued',
        }),
      ).toMatchObject({
        shouldAbortBackgroundFetch: false,
        waitForBackgroundFetch: false,
      })
    },
  )
})
