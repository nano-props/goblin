import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  readWorkspacePaneTabsForTarget,
  refreshWorkspacePaneTabsQueryData,
  workspacePaneTabsByTargetFromQueryData,
  workspacePaneTabsQueryKey,
  workspacePaneTabsQueryOptions,
  writeWorkspacePaneTabsSnapshotQueryData,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'

vi.mock('#/web/workspace-pane/workspace-pane-tabs-client.ts', () => ({
  workspacePaneTabsClient: {
    list: vi.fn(),
    replace: vi.fn(),
    update: vi.fn(),
    onChanged: vi.fn(() => () => {}),
  },
}))

const REPO_ROOT = 'goblin+file:///tmp/workspace-pane-tabs-query-repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'

beforeEach(() => {
  vi.mocked(workspacePaneTabsClient.list).mockReset()
})

test('test target construction rejects legacy raw workspace ids', () => {
  expect(() =>
    runtimeWorkspacePaneTargetForTest({
      repoRoot: '/tmp/legacy-workspace-id',
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: 'main',
      worktreePath: '/tmp/legacy-workspace-id',
    }),
  ).toThrow('workspace pane test target requires a canonical target')
})

describe('workspace pane tabs revisioned query cache', () => {
  test('accepts an identical same-revision snapshot as current', () => {
    const queryClient = new QueryClient()
    const current = snapshot(4, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])])
    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, REPO_RUNTIME_ID, current, queryClient)).toBe(true)
    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, REPO_RUNTIME_ID, current, queryClient)).toBe(true)
  })

  test('normalizes the complete snapshot and keeps no-worktree targets static-only', () => {
    const queryClient = new QueryClient()
    const accepted = writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      REPO_RUNTIME_ID,
      snapshot(4, [
        entry('feature/no-worktree', null, [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('files'),
        ]),
      ]),
      queryClient,
    )

    expect(accepted).toBe(true)
    expect(readTabs(queryClient, 'feature/no-worktree', null)).toEqual([workspacePaneStaticTabEntry('status')])
    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID)),
    ).toEqual(snapshot(4, [entry('feature/no-worktree', null, [workspacePaneStaticTabEntry('status')])]))
  })

  test('rejects an older full snapshot without losing newer changes on another target', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      REPO_RUNTIME_ID,
      snapshot(8, [
        entry('feature/a', null, [workspacePaneStaticTabEntry('history')]),
        entry('feature/b', null, [workspacePaneStaticTabEntry('status')]),
      ]),
      queryClient,
    )

    expect(
      writeWorkspacePaneTabsSnapshotQueryData(
        REPO_ROOT,
        REPO_RUNTIME_ID,
        snapshot(7, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
        queryClient,
      ),
    ).toBe(false)

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
    expect(readTabs(queryClient, 'feature/b', null)).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('accepts an equal revision as the canonical complete snapshot', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      REPO_RUNTIME_ID,
      snapshot(3, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
      queryClient,
    )

    expect(
      writeWorkspacePaneTabsSnapshotQueryData(
        REPO_ROOT,
        REPO_RUNTIME_ID,
        snapshot(3, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]),
        queryClient,
      ),
    ).toBe(true)
    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('manual refresh uses server revisions when responses resolve out of order', async () => {
    const queryClient = new QueryClient()
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const olderRequest = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID, queryClient)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const newerRequest = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID, queryClient)
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    requests[1]!.resolve(snapshot(12, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]))
    await newerRequest
    requests[0]!.resolve(snapshot(11, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]))
    await olderRequest

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('query structural sharing rejects a lower-revision fetch result', async () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      REPO_RUNTIME_ID,
      snapshot(20, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]),
      queryClient,
    )
    vi.mocked(workspacePaneTabsClient.list).mockResolvedValue(
      snapshot(19, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
    )
    await queryClient.invalidateQueries({
      queryKey: workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID),
      exact: true,
    })

    await queryClient.fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, REPO_RUNTIME_ID))

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('test target seeds preserve the cached server revision', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, REPO_RUNTIME_ID, snapshot(5, []), queryClient)

    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/a',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
      queryClient,
    )

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, REPO_RUNTIME_ID)),
    ).toEqual(snapshot(5, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]))
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
      workspacePaneTabsByTargetFromQueryData(
        snapshot(1, [
          entry('feature/current', '/tmp/worktree', [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ]),
          entry('feature/current', null, [workspacePaneStaticTabEntry('history')]),
        ]),
      ),
    ).toEqual({
      [worktreeTargetKey]: [workspacePaneStaticTabEntry('status')],
      [branchTargetKey]: [workspacePaneStaticTabEntry('history')],
    })
  })
})

function readTabs(queryClient: QueryClient, branchName: string, worktreePath: string | null) {
  return readWorkspacePaneTabsForTarget(
    { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID, branchName, worktreePath },
    queryClient,
  )
}

function snapshot(revision: number, entries: WorkspacePaneTabsEntry[]): WorkspacePaneTabsSnapshot {
  return { revision, entries }
}

function entry(
  branchName: string,
  worktreePath: string | null,
  tabs: WorkspacePaneTabsEntry['tabs'],
): WorkspacePaneTabsEntry {
  return {
    target: runtimeWorkspacePaneTargetForTest({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName,
      worktreePath,
    }),
    tabs,
  }
}
