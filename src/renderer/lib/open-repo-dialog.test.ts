import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openRepoFromDialog } from '#/renderer/lib/open-repo-dialog.ts'
import { installGoblinTestBridge } from '#/renderer/stores/repos/test-utils.ts'
import type { OpenRepoResult } from '#/renderer/stores/repos/types.ts'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

describe('openRepoFromDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens the selected path', async () => {
    installGoblinTestBridge({
      'repo.openDialog': () => '/tmp/repo',
    })
    const openRepo = vi.fn(async (): Promise<OpenRepoResult> => ({ ok: true, id: '/tmp/repo' }))

    await openRepoFromDialog({
      openRepo,
      t: (key) => key,
    })

    expect(openRepo).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('shows an error toast when opening fails', async () => {
    installGoblinTestBridge({
      'repo.openDialog': () => '/tmp/repo',
    })
    const openRepo = vi.fn(async (): Promise<OpenRepoResult> => ({ ok: false, message: 'error.not-git-repo' }))

    await openRepoFromDialog({
      openRepo,
      t: (key) => key,
    })

    expect(mocks.toastError).toHaveBeenCalledWith('drop.open-failed', {
      description: 'error.not-git-repo',
    })
  })

  test('does nothing when the dialog is cancelled', async () => {
    installGoblinTestBridge({
      'repo.openDialog': () => null,
    })
    const openRepo = vi.fn()

    await openRepoFromDialog({
      openRepo,
      t: (key) => key,
    })

    expect(openRepo).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
