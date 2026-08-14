import { QueryClient } from '@tanstack/query-core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  readWorkspacePaneTabsForTarget,
  readWorkspacePaneTabsProjectionForTarget,
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

const REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tabs-query-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'

beforeEach(() => {
  vi.mocked(workspacePaneTabsClient.list).mockReset()
})

describe('workspace pane tabs query', () => {
  test('test workspace identity construction rejects legacy raw workspace ids', () => {
    expect(() => workspaceIdForTest('/tmp/legacy-workspace-id')).toThrow(
      'invalid test workspace id: /tmp/legacy-workspace-id',
    )
  })

  test('reads workspace-root runtime tabs by their explicit target identity', () => {
    const queryClient = new QueryClient()
    const tabs = [
      workspacePaneStaticTabEntry('files'),
      workspacePaneRuntimeTabEntry('terminal', 'term-rootrootrootrootroot1'),
    ]
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      snapshot(1, [
        {
          target: runtimeWorkspacePaneTargetForTest({
            kind: 'workspace-root',
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          }),
          tabs,
        },
      ]),
      queryClient,
    )

    expect(
      readWorkspacePaneTabsForTarget(
        {
          kind: 'workspace-root',
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        },
        queryClient,
      ),
    ).toEqual(tabs)
  })

  test('accepts an identical same-revision snapshot as current', () => {
    const queryClient = new QueryClient()
    const current = snapshot(4, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])])
    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, current, queryClient)).toBe(true)
    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, current, queryClient)).toBe(true)
  })

  test('preserves stale tabs while exposing a failed query until a snapshot succeeds', async () => {
    const queryClient = new QueryClient()
    const current = snapshot(4, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])])
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, current, queryClient)
    vi.mocked(workspacePaneTabsClient.list).mockRejectedValueOnce(new Error('tabs unavailable'))

    await expect(
      refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient }),
    ).rejects.toThrow(
      'tabs unavailable',
    )

    expect(queryClient.getQueryData(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))).toEqual(current)
    expect(
      readWorkspacePaneTabsProjectionForTarget(
        {
          kind: 'git-branch',
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          branchName: 'feature/a',
        },
        queryClient,
      ),
    ).toEqual({ phase: 'failed', tabs: [workspacePaneStaticTabEntry('status')] })

    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, snapshot(5, []), queryClient)

    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.status).toBe(
      'success',
    )
  })

  test('does not fabricate default tabs before the first snapshot is accepted', async () => {
    const queryClient = new QueryClient()
    vi.mocked(workspacePaneTabsClient.list).mockRejectedValueOnce(new Error('tabs unavailable'))

    await expect(
      refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient }),
    ).rejects.toThrow('tabs unavailable')

    const target = {
      kind: 'git-branch' as const,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/a',
    }
    expect(readWorkspacePaneTabsProjectionForTarget(target, queryClient)).toEqual({ phase: 'failed', tabs: [] })
    expect(readWorkspacePaneTabsForTarget(target, queryClient)).toEqual([])
  })

  test('applies default tabs only after a successful snapshot confirms the target is absent', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, snapshot(1, []), queryClient)

    expect(
      readWorkspacePaneTabsProjectionForTarget(
        {
          kind: 'git-branch',
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          branchName: 'feature/a',
        },
        queryClient,
      ),
    ).toEqual({ phase: 'ready', tabs: [workspacePaneStaticTabEntry('status')] })
  })

  test('does not apply defaults to a target absent from a stale failed snapshot', async () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      snapshot(4, [entry('feature/a', null, [workspacePaneStaticTabEntry('files')])]),
      queryClient,
    )
    vi.mocked(workspacePaneTabsClient.list).mockRejectedValueOnce(new Error('tabs unavailable'))

    await expect(
      refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient }),
    ).rejects.toThrow('tabs unavailable')

    expect(
      readWorkspacePaneTabsProjectionForTarget(
        {
          kind: 'git-branch',
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          branchName: 'feature/b',
        },
        queryClient,
      ),
    ).toEqual({ phase: 'failed', tabs: [] })
  })

  test('normalizes the complete snapshot and keeps no-worktree targets static-only', () => {
    const queryClient = new QueryClient()
    const accepted = writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
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
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID)),
    ).toEqual(snapshot(4, [entry('feature/no-worktree', null, [workspacePaneStaticTabEntry('status')])]))
  })

  test('rejects an older full snapshot without losing newer changes on another target', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      snapshot(8, [
        entry('feature/a', null, [workspacePaneStaticTabEntry('history')]),
        entry('feature/b', null, [workspacePaneStaticTabEntry('status')]),
      ]),
      queryClient,
    )

    expect(
      writeWorkspacePaneTabsSnapshotQueryData(
        REPO_ROOT,
        WORKSPACE_RUNTIME_ID,
        snapshot(7, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
        queryClient,
      ),
    ).toBe(false)

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
    expect(readTabs(queryClient, 'feature/b', null)).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not let a rejected snapshot write clear a query failure', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, snapshot(8, []), queryClient)
    vi.mocked(workspacePaneTabsClient.list).mockRejectedValueOnce(new Error('tabs unavailable'))

    await expect(
      refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient }),
    ).rejects.toThrow(
      'tabs unavailable',
    )

    expect(
      writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, snapshot(7, []), queryClient),
    ).toBe(false)
    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.status).toBe('error')
  })

  test('authoritative snapshot success supersedes an older in-flight query failure', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
    vi.mocked(workspacePaneTabsClient.list).mockImplementationOnce(async () => await request.promise)
    const refresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(workspacePaneTabsClient.list).toHaveBeenCalledOnce())

    const committed = snapshot(9, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])])
    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, committed, queryClient)).toBe(true)
    request.reject(new Error('stale query failure'))
    await expect(refresh).resolves.toBeUndefined()

    expect(queryClient.getQueryData(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))).toEqual(committed)
    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.status).toBe(
      'success',
    )
  })

  test('does not cancel a refresh that is pursuing a higher revision', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const current = snapshot(4, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])])
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, current, queryClient)
    const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
    vi.mocked(workspacePaneTabsClient.list).mockImplementationOnce(async () => await request.promise)
    const refresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(workspacePaneTabsClient.list).toHaveBeenCalledOnce())

    expect(writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, current, queryClient)).toBe(true)
    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.fetchStatus).toBe(
      'fetching',
    )

    const next = snapshot(5, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])])
    request.resolve(next)
    await refresh

    expect(queryClient.getQueryData(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))).toEqual(next)
  })

  test('accepts an equal revision as the canonical complete snapshot', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      snapshot(3, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
      queryClient,
    )

    expect(
      writeWorkspacePaneTabsSnapshotQueryData(
        REPO_ROOT,
        WORKSPACE_RUNTIME_ID,
        snapshot(3, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]),
        queryClient,
      ),
    ).toBe(true)
    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('coalesces concurrent refreshes through the query lifecycle', async () => {
    const queryClient = new QueryClient()
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const firstRefresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const secondRefresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)

    requests[0]!.resolve(snapshot(12, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]))
    await Promise.all([firstRefresh, secondRefresh])

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('performs one post-trigger read when a fresh recovery joined an older query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const initial = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const fresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      queryClient,
      requirement: { kind: 'fresh' },
    })
    requests[0]!.resolve(snapshot(4, []))
    await initial
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    requests[1]!.resolve(snapshot(5, []))
    await fresh

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID),
      )?.revision,
    ).toBe(5)
  })

  test('still performs the post-trigger read when the joined query failed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const initial = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    const initialFailure = expect(initial).rejects.toThrow('old request failed')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const fresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      queryClient,
      requirement: { kind: 'fresh' },
    })
    requests[0]!.reject(new Error('old request failed'))
    await initialFailure
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    requests[1]!.resolve(snapshot(5, []))
    await fresh

    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.status).toBe(
      'success',
    )
  })

  test('performs one fresh read when a minimum revision joined an older query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const initial = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const required = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      queryClient,
      requirement: { kind: 'minimum-revision', revision: 5 },
    })
    requests[0]!.resolve(snapshot(4, []))
    await initial
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    requests[1]!.resolve(snapshot(5, []))
    await required

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID),
      )?.revision,
    ).toBe(5)
  })

  test('fails after one fresh read cannot satisfy a published minimum revision', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const requests: Array<ReturnType<typeof Promise.withResolvers<WorkspacePaneTabsSnapshot>>> = []
    vi.mocked(workspacePaneTabsClient.list).mockImplementation(async () => {
      const request = Promise.withResolvers<WorkspacePaneTabsSnapshot>()
      requests.push(request)
      return await request.promise
    })

    const initial = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, { queryClient })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const required = refreshWorkspacePaneTabsQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      queryClient,
      requirement: { kind: 'minimum-revision', revision: 5 },
    })
    requests[0]!.resolve(snapshot(4, []))
    await initial
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    requests[1]!.resolve(snapshot(4, []))
    await expect(required).rejects.toThrow('required revision 5; received 4')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requests).toHaveLength(2)
    expect(queryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID))?.status).toBe('error')
  })

  test('query structural sharing rejects a lower-revision fetch result', async () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      snapshot(20, [entry('feature/a', null, [workspacePaneStaticTabEntry('history')])]),
      queryClient,
    )
    vi.mocked(workspacePaneTabsClient.list).mockResolvedValue(
      snapshot(19, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]),
    )
    await queryClient.invalidateQueries({
      queryKey: workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID),
      exact: true,
    })

    await queryClient.fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, WORKSPACE_RUNTIME_ID))

    expect(readTabs(queryClient, 'feature/a', null)).toEqual([workspacePaneStaticTabEntry('history')])
  })

  test('test target seeds preserve the cached server revision', () => {
    const queryClient = new QueryClient()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ROOT, WORKSPACE_RUNTIME_ID, snapshot(5, []), queryClient)

    setWorkspacePaneTabsForTargetQueryData(
      {
        kind: 'git-branch' as const,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        branchName: 'feature/a',
        tabs: [workspacePaneStaticTabEntry('status')],
      },
      queryClient,
    )

    expect(
      queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(REPO_ROOT, WORKSPACE_RUNTIME_ID)),
    ).toEqual(snapshot(5, [entry('feature/a', null, [workspacePaneStaticTabEntry('status')])]))
  })

  test('persists worktree and branch-only entries under separate target identities', () => {
    const worktreeTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ROOT,
      worktreePath: '/tmp/worktree',
    })
    const branchTargetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch' as const,
      workspaceId: REPO_ROOT,
      branchName: 'feature/current',
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
  const target =
    worktreePath === null
      ? { kind: 'git-branch' as const, workspaceId: REPO_ROOT, branchName }
      : {
          kind: 'git-worktree' as const,
          workspaceId: REPO_ROOT,
          worktreePath,
        }
  return readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }, queryClient)
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
      ...(worktreePath === null
        ? { kind: 'git-branch' as const, workspaceId: REPO_ROOT, branchName }
        : {
            kind: 'git-worktree' as const,
            workspaceId: REPO_ROOT,
            worktreePath,
          }),
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    }),
    tabs,
  }
}
