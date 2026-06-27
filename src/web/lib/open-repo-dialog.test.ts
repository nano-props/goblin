import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
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
    const ensureWorkspaceOpen = vi.fn(async (): Promise<OpenRepoResult> => ({ ok: true, id: '/tmp/repo' }))
    const activateRepo = vi.fn()

    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo,
      t: (key) => key,
    })

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/repo')
    expect(activateRepo).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('shows an error toast when opening fails', async () => {
    installGoblinTestBridge({
      'repo.openDialog': () => '/tmp/repo',
    })
    const ensureWorkspaceOpen = vi.fn(
      async (): Promise<OpenRepoResult> => ({ ok: false, message: 'error.not-git-repo' }),
    )
    const activateRepo = vi.fn()

    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo,
      t: (key) => key,
    })

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/repo')
    expect(activateRepo).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('drop.open-failed', {
      description: 'error.not-git-repo',
    })
  })

  test('does nothing when the dialog is cancelled', async () => {
    installGoblinTestBridge({
      'repo.openDialog': () => null,
    })
    const ensureWorkspaceOpen = vi.fn()
    const activateRepo = vi.fn()

    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo,
      t: (key) => key,
    })

    expect(ensureWorkspaceOpen).not.toHaveBeenCalled()
    expect(activateRepo).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('falls back to the path dialog when no native directory picker exists', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    const ensureWorkspaceOpen = vi.fn()
    const activateRepo = vi.fn()
    const openRepoPathDialog = vi.fn()

    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo,
      openRepoPathDialog,
      t: (key) => key,
    })

    expect(openRepoPathDialog).toHaveBeenCalledTimes(1)
    expect(ensureWorkspaceOpen).not.toHaveBeenCalled()
    expect(activateRepo).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
