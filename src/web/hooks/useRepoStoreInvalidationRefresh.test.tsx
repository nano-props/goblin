// @vitest-environment jsdom
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { useQuery } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoStoreInvalidationRefresh } from '#/web/hooks/useRepoStoreInvalidationRefresh.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoDataQueryKey } from '#/web/repo-query-keys.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { repoSnapshotQueryOptions } from '#/web/repo-query-options.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoSnapshot: vi.fn(),
  getRepoOperations: vi.fn(),
  getRepoWorktreeStatus: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => repoClientMocks)

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

const listeners = new Set<(event: any) => void>()
const openListeners = new Set<() => void>()
function workspace() {
  const value = emptyWorkspace(WORKSPACE_ID, 'repo-runtime-test-7')
  acceptWorkspaceProbeState(value, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  })
  return value
}
const storeState = {
  workspaces: {
    [WORKSPACE_ID]: workspace(),
  },
}

vi.mock('#/web/repo-read-invalidation-ingress.ts', () => ({
  subscribeRepoReadInvalidation(listener: (event: any) => void, onOpen?: () => void) {
    listeners.add(listener)
    if (onOpen) openListeners.add(onOpen)
    return () => {
      listeners.delete(listener)
      if (onOpen) openListeners.delete(onOpen)
    }
  },
}))

vi.mock('#/web/stores/workspaces/store.ts', () => ({
  workspacesStore: {
    getState: () => storeState,
    setState: vi.fn(),
  },
}))

const Harness = defineComponent({
  name: 'RepoStoreInvalidationHarness',
  setup() {
    useRepoStoreInvalidationRefresh()
    return () => null
  },
})

const ProjectionObserverHarness = defineComponent({
  name: 'RepoStoreInvalidationProjectionObserver',
  setup() {
    useRepoStoreInvalidationRefresh()
    const projection = useQuery(repoSnapshotQueryOptions(WORKSPACE_ID, 'repo-runtime-test-7'), appQueryClient)
    return () => <output>{projection.data.value?.snapshot.current ?? 'loading'}</output>
  },
})

describe('useRepoStoreInvalidationRefresh', () => {
  beforeEach(() => {
    useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    listeners.clear()
    openListeners.clear()
    appQueryClient.clear()
    storeState.workspaces[WORKSPACE_ID] = workspace()
  })

  afterEach(() => {
    listeners.clear()
    openListeners.clear()
    appQueryClient.clear()
  })

  test('handles metadata invalidations through query invalidation only', async () => {
    const invalidateSpy = vi.spyOn(appQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await flushTestUpdates(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-read-invalidated', repoId: WORKSPACE_ID, domain: 'metadata' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'repo-runtime-test-7'),
        refetchType: 'active',
        predicate: expect.any(Function),
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    invalidateSpy.mockRestore()
  })

  test('metadata invalidation makes an active observer accept the final projection', async () => {
    let projectionReads = 0
    repoClientMocks.getRepoSnapshot.mockImplementation(async () => {
      projectionReads += 1
      return {
        snapshot: {
          branches: [],
          current: projectionReads === 1 ? 'before-fetch' : 'after-fetch',
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      }
    })
    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <ProjectionObserverHarness />
      </VueQueryClientScope>,
    )
    await vi.waitFor(() => {
      expect(projectionReads).toBe(1)
      expect(document.body.textContent).toContain('before-fetch')
    })

    await flushTestUpdates(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-read-invalidated', repoId: WORKSPACE_ID, domain: 'metadata' })
      }
    })

    await vi.waitFor(() => {
      expect(projectionReads).toBe(2)
      expect(document.body.textContent).toContain('after-fetch')
    })
  })

  test('connection open invalidates an in-flight projection and accepts a current read', async () => {
    let resolveFirstRead!: (value: Awaited<ReturnType<typeof repoClientMocks.getRepoSnapshot>>) => void
    let projectionReads = 0
    repoClientMocks.getRepoSnapshot.mockImplementation(async () => {
      projectionReads += 1
      if (projectionReads === 1) {
        return await new Promise((resolve) => {
          resolveFirstRead = resolve
        })
      }
      return {
        snapshot: {
          branches: [],
          current: 'after-connect',
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      }
    })
    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <ProjectionObserverHarness />
      </VueQueryClientScope>,
    )
    await vi.waitFor(() => expect(projectionReads).toBe(1))

    await flushTestUpdates(async () => {
      for (const listener of openListeners) listener()
      resolveFirstRead({
        snapshot: {
          branches: [],
          current: 'before-connect',
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      })
    })

    await vi.waitFor(() => {
      expect(projectionReads).toBe(2)
      expect(document.body.textContent).toContain('after-connect')
    })
  })

  test('limits repo-runtime invalidations to operation queries', async () => {
    const invalidateSpy = vi.spyOn(appQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await flushTestUpdates(async () => {
      for (const listener of listeners)
        listener({ type: 'repo-read-invalidated', repoId: WORKSPACE_ID, domain: 'operations' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: ['repo-data', WORKSPACE_ID, 'repo-runtime-test-7', 'operations'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    invalidateSpy.mockRestore()
  })

  test('refreshes invalidations even when extra transport metadata is present', async () => {
    const invalidateSpy = vi.spyOn(appQueryClient, 'invalidateQueries')
    renderInJsdom(<Harness />)

    await flushTestUpdates(async () => {
      for (const listener of listeners)
        listener({
          type: 'repo-read-invalidated',
          repoId: WORKSPACE_ID,
          domain: 'metadata',
          ignoredMetadata: 'repo_manual_other',
        })
    })

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'repo-runtime-test-7'),
        refetchType: 'active',
        predicate: expect.any(Function),
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    invalidateSpy.mockRestore()
  })
})
