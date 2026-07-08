import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsByTargetFromQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-query-repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'

describe('workspace pane tabs query cache', () => {
  test('keeps no-worktree branch cache entries static-only', () => {
    const queryClient = new QueryClient()

    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('files'),
        ],
      },
      queryClient,
    )

    expect(
      readWorkspacePaneTabsForTarget(
        {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branchName: 'feature/no-worktree',
          worktreePath: null,
        },
        queryClient,
      ),
    ).toEqual([workspacePaneStaticTabEntry('status')])
    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID)),
    ).toEqual([entry('feature/no-worktree', null, [workspacePaneStaticTabEntry('status')])])
  })

  test('dedupes polluted branch cache entries on write', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID), [
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('status')]),
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('history')]),
    ])

    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/new',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
      queryClient,
    )

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID)),
    ).toEqual([
      entry('feature/duplicate', '/tmp/worktree', [workspacePaneStaticTabEntry('history')]),
      entry('feature/new', null, [workspacePaneStaticTabEntry('status')]),
    ])
  })

  test('reads and retargets worktree entries by worktree identity', () => {
    const queryClient = new QueryClient()
    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/old',
        worktreePath: '/tmp/worktree',
        tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('status')],
      },
      queryClient,
    )

    expect(
      readWorkspacePaneTabsForTarget(
        {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branchName: 'feature/new',
          worktreePath: '/tmp/worktree',
        },
        queryClient,
      ),
    ).toEqual([workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('status')])

    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/new',
        worktreePath: '/tmp/worktree',
        tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('history')],
      },
      queryClient,
    )

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID)),
    ).toEqual([
      entry('feature/new', '/tmp/worktree', [
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('history'),
      ]),
    ])
  })

  test('persists worktree and branch-only entries under separate target identities', () => {
    const worktreeTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: REPO_ROOT,
      branchName: 'feature/current',
      worktreePath: '/tmp/worktree',
    })
    const branchTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: REPO_ROOT,
      branchName: 'feature/current',
      worktreePath: null,
    })

    expect(
      workspacePaneTabsByTargetFromQueryData([
        entry('feature/current', '/tmp/worktree', [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneStaticTabEntry('status'),
        ]),
        entry('feature/current', null, [workspacePaneStaticTabEntry('history')]),
      ]),
    ).toEqual({
      [worktreeTargetKey]: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'), workspacePaneStaticTabEntry('status')],
      [branchTargetKey]: [workspacePaneStaticTabEntry('history')],
    })
  })
})

function entry(
  branchName: string,
  worktreePath: string | null,
  tabs: WorkspacePaneTabsEntry['tabs'],
): WorkspacePaneTabsEntry {
  return { repoRoot: REPO_ROOT, branchName, worktreePath, tabs }
}
