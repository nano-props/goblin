import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { CLIENT_BRIDGE_VERSION, WEB_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}))

describe('openWorkspaceFromDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens the selected path', async () => {
    installGoblinTestBridge({
      'workspace.openDialog': () => '/tmp/repo',
    })
    const openWorkspaceMembership = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: true,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
    }))
    const activateWorkspace = vi.fn()

    await openWorkspaceFromDialog({
      openWorkspaceMembership,
      activateWorkspace,
      t: (key) => key,
    })

    expect(openWorkspaceMembership).toHaveBeenCalledWith('/tmp/repo')
    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('shows a post-open error toast without blocking activation', async () => {
    installGoblinTestBridge({
      'workspace.openDialog': () => '/tmp/repo',
    })
    const openWorkspaceMembership = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: true,
      workspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
      postOpenEffects: Promise.resolve([{ kind: 'recent-workspace', message: 'recent write failed' }]),
    }))
    const activateWorkspace = vi.fn()

    await openWorkspaceFromDialog({
      openWorkspaceMembership,
      activateWorkspace,
      t: (key) => key,
    })

    expect(activateWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo')
    await Promise.resolve()
    expect(mocks.toastError).toHaveBeenCalledWith('workspace-picker.recent-save-failed', {
      description: 'recent write failed',
    })
  })

  test('shows an error toast when opening fails', async () => {
    installGoblinTestBridge({
      'workspace.openDialog': () => '/tmp/repo',
    })
    const openWorkspaceMembership = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: false,
      kind: 'failed',
      message: 'error.workspace-git-unavailable',
    }))
    const activateWorkspace = vi.fn()

    await openWorkspaceFromDialog({
      openWorkspaceMembership,
      activateWorkspace,
      t: (key) => key,
    })

    expect(openWorkspaceMembership).toHaveBeenCalledWith('/tmp/repo')
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('drop.open-failed', {
      description: 'error.workspace-git-unavailable',
    })
  })

  test('surfaces an uncertain open without activating the established workspace', async () => {
    installGoblinTestBridge({
      'workspace.openDialog': () => '/tmp/repo',
    })
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/repo')
    const openWorkspaceMembership = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: false,
      kind: 'uncertain',
      workspaceId,
      message: 'error.operation-outcome-uncertain',
    }))
    const activateWorkspace = vi.fn()

    await openWorkspaceFromDialog({ openWorkspaceMembership, activateWorkspace, t: (key) => key })

    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastWarning).toHaveBeenCalledWith('drop.open-failed', {
      description: 'error.operation-outcome-uncertain',
    })
  })

  test('does nothing when the dialog is cancelled', async () => {
    installGoblinTestBridge({
      'workspace.openDialog': () => null,
    })
    const openWorkspaceMembership = vi.fn()
    const activateWorkspace = vi.fn()

    await openWorkspaceFromDialog({
      openWorkspaceMembership,
      activateWorkspace,
      t: (key) => key,
    })

    expect(openWorkspaceMembership).not.toHaveBeenCalled()
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  test('opens the path dialog in the web runtime', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'http://127.0.0.1:32101/',
          origin: 'http://127.0.0.1:32101',
          search: '',
        },
        __GOBLIN_BOOTSTRAP__: {
          runtime: {
            kind: 'web',
            bridgeVersion: CLIENT_BRIDGE_VERSION,
            capabilities: WEB_CLIENT_CAPABILITIES,
          },
          initialServer: null,
        },
      },
    })
    const openWorkspaceMembership = vi.fn()
    const activateWorkspace = vi.fn()
    const openWorkspacePathDialog = vi.fn()

    await openWorkspaceFromDialog({
      openWorkspaceMembership,
      activateWorkspace,
      openWorkspacePathDialog,
      t: (key) => key,
    })

    expect(openWorkspacePathDialog).toHaveBeenCalledTimes(1)
    expect(openWorkspaceMembership).not.toHaveBeenCalled()
    expect(activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
