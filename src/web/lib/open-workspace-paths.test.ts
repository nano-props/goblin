import { describe, expect, test, vi } from 'vitest'
import { openWorkspacePaths } from '#/web/lib/open-workspace-paths.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('openWorkspacePaths', () => {
  test('opens paths without per-item activation and focuses the first success', async () => {
    const openWorkspaceMembership = vi
      .fn<(path: string) => Promise<OpenWorkspaceResult>>()
      .mockResolvedValueOnce({ ok: false, message: 'error.workspace-git-unavailable' })
      .mockResolvedValueOnce({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///tmp/workspace-b') })
      .mockResolvedValueOnce({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///tmp/workspace-c') })
    const activateWorkspace = vi.fn()
    const onOpenFailed = vi.fn()

    const firstId = await openWorkspacePaths(['/tmp/a', '/tmp/b', '/tmp/c'], {
      openWorkspaceMembership,
      activateWorkspace,
      onOpenFailed,
    })

    expect(firstId).toBe('goblin+file:///tmp/workspace-b')
    expect(openWorkspaceMembership).toHaveBeenNthCalledWith(1, '/tmp/a')
    expect(openWorkspaceMembership).toHaveBeenNthCalledWith(2, '/tmp/b')
    expect(openWorkspaceMembership).toHaveBeenNthCalledWith(3, '/tmp/c')
    expect(onOpenFailed).toHaveBeenCalledWith('/tmp/a', 'error.workspace-git-unavailable')
    expect(activateWorkspace).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/workspace-b')
  })

  test('does not activate anything when every path fails', async () => {
    const openWorkspaceMembership = vi.fn().mockResolvedValue({ ok: false, message: 'error.workspace-git-unavailable' })
    const activateWorkspace = vi.fn()

    const firstId = await openWorkspacePaths(['/tmp/a'], {
      openWorkspaceMembership,
      activateWorkspace,
    })

    expect(firstId).toBeNull()
    expect(activateWorkspace).not.toHaveBeenCalled()
  })

  test('reports post-open errors without treating the path as failed', async () => {
    const openWorkspaceMembership = vi.fn<(path: string) => Promise<OpenWorkspaceResult>>().mockResolvedValue({
      ok: true,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/workspace-a'),
      postOpenEffects: Promise.resolve([{ kind: 'recent-workspace', message: 'recent write failed' }]),
    })
    const activateWorkspace = vi.fn()
    const onOpenFailed = vi.fn()
    const onPostOpenError = vi.fn()

    const firstId = await openWorkspacePaths(['/tmp/a'], {
      openWorkspaceMembership,
      activateWorkspace,
      onOpenFailed,
      onPostOpenError,
    })

    expect(firstId).toBe('goblin+file:///tmp/workspace-a')
    expect(onOpenFailed).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(onPostOpenError).toHaveBeenCalledWith('/tmp/a', 'recent write failed')
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/workspace-a')
  })
})
