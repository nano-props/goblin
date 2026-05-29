import { describe, expect, test, vi } from 'vitest'
import { openRepoPaths } from '#/renderer/lib/open-repo-paths.ts'

describe('openRepoPaths', () => {
  test('opens paths without per-item activation and focuses the first success', async () => {
    const openRepo = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'error.not-git-repo' })
      .mockResolvedValueOnce({ ok: true, id: '/tmp/repo-b' })
      .mockResolvedValueOnce({ ok: true, id: '/tmp/repo-c' })
    const setActive = vi.fn()
    const onOpenFailed = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a', '/tmp/b', '/tmp/c'], {
      openRepo,
      setActive,
      onOpenFailed,
    })

    expect(firstId).toBe('/tmp/repo-b')
    expect(openRepo).toHaveBeenNthCalledWith(1, '/tmp/a', { activate: false })
    expect(openRepo).toHaveBeenNthCalledWith(2, '/tmp/b', { activate: false })
    expect(openRepo).toHaveBeenNthCalledWith(3, '/tmp/c', { activate: false })
    expect(onOpenFailed).toHaveBeenCalledWith('/tmp/a', 'error.not-git-repo')
    expect(setActive).toHaveBeenCalledTimes(1)
    expect(setActive).toHaveBeenCalledWith('/tmp/repo-b')
  })

  test('does not activate anything when every path fails', async () => {
    const openRepo = vi.fn().mockResolvedValue({ ok: false, message: 'error.not-git-repo' })
    const setActive = vi.fn()

    const firstId = await openRepoPaths(['/tmp/a'], {
      openRepo,
      setActive,
    })

    expect(firstId).toBeNull()
    expect(setActive).not.toHaveBeenCalled()
  })
})
