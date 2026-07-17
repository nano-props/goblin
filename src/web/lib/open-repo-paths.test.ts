import { describe, expect, test, vi } from 'vitest'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'

describe('openRepoPaths', () => {
  test('opens paths without per-item activation and focuses the first success', async () => {
    const ensureWorkspaceOpen = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'error.workspace-git-unavailable' })
      .mockResolvedValueOnce({ ok: true, id: 'goblin+file:///tmp/repo-b' })
      .mockResolvedValueOnce({ ok: true, id: 'goblin+file:///tmp/repo-c' })
    const activateRepo = vi.fn()
    const onOpenFailed = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a', '/tmp/b', '/tmp/c'], {
      ensureWorkspaceOpen,
      activateRepo,
      onOpenFailed,
    })

    expect(firstId).toBe('goblin+file:///tmp/repo-b')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(1, '/tmp/a')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(2, '/tmp/b')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(3, '/tmp/c')
    expect(onOpenFailed).toHaveBeenCalledWith('/tmp/a', 'error.workspace-git-unavailable')
    expect(activateRepo).toHaveBeenCalledTimes(1)
    expect(activateRepo).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
  })

  test('does not activate anything when every path fails', async () => {
    const ensureWorkspaceOpen = vi.fn().mockResolvedValue({ ok: false, message: 'error.workspace-git-unavailable' })
    const activateRepo = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a'], {
      ensureWorkspaceOpen,
      activateRepo,
    })

    expect(firstId).toBeNull()
    expect(activateRepo).not.toHaveBeenCalled()
  })

  test('reports post-open errors without treating the path as failed', async () => {
    const ensureWorkspaceOpen = vi.fn().mockResolvedValue({
      ok: true,
      id: 'goblin+file:///tmp/repo-a',
      postOpenEffects: Promise.resolve([{ kind: 'recent-repo', message: 'recent write failed' }]),
    })
    const activateRepo = vi.fn()
    const onOpenFailed = vi.fn()
    const onPostOpenError = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a'], {
      ensureWorkspaceOpen,
      activateRepo,
      onOpenFailed,
      onPostOpenError,
    })

    expect(firstId).toBe('goblin+file:///tmp/repo-a')
    expect(onOpenFailed).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(onPostOpenError).toHaveBeenCalledWith('/tmp/a', 'recent write failed')
    expect(activateRepo).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
  })
})
