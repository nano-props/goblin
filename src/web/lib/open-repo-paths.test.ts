import { describe, expect, test, vi } from 'vitest'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'

describe('openRepoPaths', () => {
  test('opens paths without per-item activation and focuses the first success', async () => {
    const ensureWorkspaceOpen = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'error.not-git-repo' })
      .mockResolvedValueOnce({ ok: true, id: '/tmp/repo-b' })
      .mockResolvedValueOnce({ ok: true, id: '/tmp/repo-c' })
    const activateRepo = vi.fn()
    const onOpenFailed = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a', '/tmp/b', '/tmp/c'], {
      ensureWorkspaceOpen,
      activateRepo,
      onOpenFailed,
    })

    expect(firstId).toBe('/tmp/repo-b')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(1, '/tmp/a')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(2, '/tmp/b')
    expect(ensureWorkspaceOpen).toHaveBeenNthCalledWith(3, '/tmp/c')
    expect(onOpenFailed).toHaveBeenCalledWith('/tmp/a', 'error.not-git-repo')
    expect(activateRepo).toHaveBeenCalledTimes(1)
    expect(activateRepo).toHaveBeenCalledWith('/tmp/repo-b')
  })

  test('does not activate anything when every path fails', async () => {
    const ensureWorkspaceOpen = vi.fn().mockResolvedValue({ ok: false, message: 'error.not-git-repo' })
    const activateRepo = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a'], {
      ensureWorkspaceOpen,
      activateRepo,
    })

    expect(firstId).toBeNull()
    expect(activateRepo).not.toHaveBeenCalled()
  })
})
