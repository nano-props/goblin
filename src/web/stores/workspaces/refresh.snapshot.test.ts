import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  REPO_ID,
  branch,
  cachedRepoSnapshot,
  ipcHandlers,
  refreshStoreAccess,
  repoSnapshotResponse,
  resetRefreshTest,
  seedRepo,
} from '#/web/stores/workspaces/refresh-test-utils.ts'

beforeEach(resetRefreshTest)

describe('repository snapshot refresh', () => {
  test('replaces the runtime-scoped snapshot query without mirroring it into Zustand', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.snapshot'] = () =>
      repoSnapshotResponse({ branches: [branch('main'), branch('feature/a')], current: 'feature/a' })

    await requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(cachedRepoSnapshot(workspaceRuntimeId)?.branches.map((candidate) => candidate.name)).toEqual([
      'main',
      'feature/a',
    ])
    const workspace = workspacesStore.getState().workspaces[REPO_ID]
    expect(workspace?.capability.kind).toBe('git')
    expect(workspace && workspace.capability.kind === 'git' ? Object.keys(workspace.capability.git) : []).toEqual(
      expect.not.arrayContaining(['dataLoads', 'remote']),
    )
  })

  test('keeps accepted snapshot data mounted when a background refresh fails', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.snapshot'] = () => {
      throw new Error('snapshot unavailable')
    }

    await requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(cachedRepoSnapshot(workspaceRuntimeId)?.current).toBe('main')
    const workspace = workspacesStore.getState().workspaces[REPO_ID]
    const events = workspace?.capability.kind === 'git' ? workspace.capability.git.events : []
    expect(events.at(-1)).toMatchObject({ kind: 'error', message: 'error.failed-read-repo' })
  })

  test('does not place a response for an old runtime into the reopened runtime query', async () => {
    const firstRuntimeId = seedRepo([branch('main')], 'repo-runtime-first')
    let resolveRead!: (value: ReturnType<typeof repoSnapshotResponse>) => void
    ipcHandlers['repo.snapshot'] = () =>
      new Promise((resolve) => {
        resolveRead = resolve
      })
    const refresh = requestRepoSnapshotRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId: firstRuntimeId })
    await vi.waitFor(() => expect(resolveRead).toEqual(expect.any(Function)))

    const secondRuntimeId = seedRepo([branch('reopened')], 'repo-runtime-second')
    resolveRead(repoSnapshotResponse({ branches: [branch('stale')], current: 'stale' }))
    await refresh

    expect(getRepoSnapshotQueryData(REPO_ID, secondRuntimeId)?.current).toBe('reopened')
  })
})
