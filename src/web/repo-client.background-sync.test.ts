// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/background-sync-client')

describe('background sync client registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('increments the page-scoped revision with each client declaration', async () => {
    const bodies: Array<{ clientId: string; revision: number }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as { clientId: string; revision: number })
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    const targets = [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-background-sync-client' }]

    await setBackgroundSyncRepos(targets)
    await setBackgroundSyncRepos(targets)

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.clientId).toBe(bodies[1]?.clientId)
    expect(bodies[1]?.revision).toBe((bodies[0]?.revision ?? 0) + 1)
  })
})
