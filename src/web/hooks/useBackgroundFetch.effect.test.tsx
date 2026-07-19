// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useBackgroundFetch } from '#/web/hooks/useBackgroundFetch.ts'
import { resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const mocks = vi.hoisted(() => ({
  setBackgroundSyncRepos: vi.fn(async (_targets: unknown, _signal?: AbortSignal) => {}),
}))

vi.mock('#/web/repo-client.ts', () => ({
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
}))

vi.mock('#/web/runtime-settings-fetch.ts', () => ({
  useFetchSettings: () => ({ fetchIntervalSec: 30 }),
}))

vi.mock('#/web/lib/server-config.ts', () => ({
  hasClientServerConfig: () => true,
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/background-sync')

describe('useBackgroundFetch request lifecycle', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    mocks.setBackgroundSyncRepos.mockClear()
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      remote: { hasRemotes: true },
      workspaceRuntimeId: 'workspace-runtime-background-sync',
    })
  })

  test('cancels superseded and unmounted registration requests', async () => {
    const view = renderInJsdom(<BackgroundFetchHost workspaceId={WORKSPACE_ID} />)
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledOnce())
    const firstSignal = mocks.setBackgroundSyncRepos.mock.calls[0]?.[1]

    view.rerender(<BackgroundFetchHost workspaceId={null} />)
    await vi.waitFor(() => expect(mocks.setBackgroundSyncRepos).toHaveBeenCalledTimes(2))
    const secondSignal = mocks.setBackgroundSyncRepos.mock.calls[1]?.[1]

    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal?.aborted).toBe(false)
    view.unmount()
    expect(secondSignal?.aborted).toBe(true)
  })
})

function BackgroundFetchHost({ workspaceId }: { workspaceId: WorkspaceId | null }) {
  useBackgroundFetch({ currentWorkspaceId: workspaceId })
  return null
}
