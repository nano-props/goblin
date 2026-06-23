// @vitest-environment jsdom

// Integration regression test for the focus-mode "Delete worktree does
// nothing" bug. The old design coupled dialog state to whichever React
// subtree rendered the row's menu; when that subtree (a HoverCard) was
// torn down by Radix's 150 ms close timer, the confirm dialog state
// went with it and `git worktree remove` never ran.
//
// These tests assert the two halves of the fix:
//   1. The store outlives any surface — `useBranchActionDialogsStore`
//      keeps the slot open across unmount/remount of any React subtree.
//   2. The dialog host renders the dialog from store state and wires
//      its onConfirm into the dispatch path, regardless of which
//      surface originally requested the action.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import {
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { idleOperation } from '#/web/stores/repos/operations.ts'

const dispatchMocks = vi.hoisted(() => ({
  runBranchAction: vi.fn((_id: string, _action: { kind: string }) => Promise.resolve({ ok: true, message: 'ok' })),
}))

vi.mock('#/web/stores/repos/branch-action-write-paths.ts', () => ({
  dispatchRepoBranchAction: vi.fn(async (_id: string, _token: number, action: { kind: string }) => {
    dispatchMocks.runBranchAction(_id, action)
    return { ok: true, message: 'ok' }
  }),
  dispatchRepoUiAction: vi.fn(),
  isPushProtected: () => false,
  deleteBranchNeedsForceConfirm: () => false,
  removeWorktreeNeedsForceConfirm: () => false,
}))

const reposStoreMocks = vi.hoisted(() => ({
  state: { runBranchAction: dispatchMocks.runBranchAction } as Record<string, unknown>,
  setState: vi.fn(),
}))

vi.mock('#/web/stores/repos/store.ts', () => ({
  useReposStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    {
      setState: vi.fn(),
      getState: () => ({}),
    },
  ),
  // test-utils.resetReposStore calls useReposStore.setState — expose a noop.
  // The actual store state for these tests is irrelevant; the dialog
  // host reads from the branch-action-dialogs store directly.
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/web/stores/repos/helpers.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/helpers.ts')>()
  return {
    ...actual,
    remoteRepoTarget: () => null,
  }
})

const REPO_ID = '/tmp/gbl-dialog-host-test'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function setupRepo() {
  const worktreePath = '/tmp/dialog-host-worktree'
  const branch = createRepoBranch('feature/host', { worktree: { path: worktreePath } })
  const repo = seedRepoState({ id: REPO_ID, branches: [branch] })
  return { repo, branch, worktreePath }
}

function buildRepo(repo: ReturnType<typeof seedRepoState>): BranchActionRepo {
  return {
    id: repo.id,
    instanceToken: repo.instanceToken,
    data: {
      currentBranch: repo.data.currentBranch,
      status: repo.data.status,
      worktreesByPath: repo.data.worktreesByPath,
    },
    operations: { branchAction: idleOperation() },
    remote: {
      lifecycle: null,
      hasRemotes: true,
      hasBrowserRemote: false,
      hasGitHubRemote: false,
      browserRemoteProvider: undefined,
      remoteProviders: {},
    },
  }
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  resetBranchActionDialogsStore()
  dispatchMocks.runBranchAction.mockReset()
  dispatchMocks.runBranchAction.mockImplementation(
    (_id: string, _action: { kind: string }) => Promise.resolve({ ok: true, message: 'ok' }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function findButtonByText(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  return buttons.find((b) => b.textContent?.includes(text)) ?? null
}

describe('BranchActionDialogHost', () => {
  test('regression: store state survives a full unmount/remount cycle of the host', () => {
    // Simulates the focus-mode scenario in two halves:
    //   (a) caller in a temporary surface (popover) opens the dialog
    //   (b) the temporary surface unmounts (HoverCard close timer fires)
    //   (c) a stable surface (the workspace) re-mounts the host
    //   (d) the dialog must still be visible there.
    const { repo, branch } = setupRepo()
    const repoView = buildRepo(repo)

    const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }

    // (a) Caller opens the dialog via the store — this is what
    // `useBranchActions.requestRemoveWorktree` does internally today.
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: branch.name, payload },
        { isProtectedBranch: false },
      )
    })

    // Mount the host (would have been mounted already by BranchWorkspace).
    render(<BranchActionDialogHost repo={repoView} branch={branch} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // (b) + (c) Unmount + remount — the popover went away and came back.
    act(() => {
      root!.unmount()
    })
    root = createRoot(container!)
    render(<BranchActionDialogHost repo={repoView} branch={branch} />)

    // (d) Dialog still rendered, store still holds the entry.
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')
    expect(useBranchActionDialogsStore.getState().removeConfirm?.payload).toEqual(payload)
  })

  test('clicking Confirm dispatches removeWorktree with the current checkbox state', async () => {
    const { repo, branch } = setupRepo()
    const repoView = buildRepo(repo)
    render(<BranchActionDialogHost repo={repoView} branch={branch} />)

    const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: branch.name, payload },
        { isProtectedBranch: false },
      )
    })

    const confirmButton = findButtonByText('action.confirm-remove-worktree-confirm')
    expect(confirmButton).not.toBeNull()

    await act(async () => {
      confirmButton!.click()
      await Promise.resolve()
    })

    expect(dispatchMocks.runBranchAction).toHaveBeenCalledTimes(1)
    const call = dispatchMocks.runBranchAction.mock.calls[0]!
    expect(call[0]).toBe(REPO_ID)
    expect(call[1]).toEqual({
      kind: 'removeWorktree',
      branch: branch.name,
      worktreePath: branch.worktree!.path,
      alsoDeleteBranch: true,
      forceDeleteBranch: false,
      alsoDeleteUpstream: false,
    })
    expect(useBranchActionDialogsStore.getState().removeConfirm).toBeNull()
  })

  test('clicking Cancel closes the dialog without dispatching', async () => {
    const { repo, branch } = setupRepo()
    const repoView = buildRepo(repo)
    render(<BranchActionDialogHost repo={repoView} branch={branch} />)

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: branch.name, payload: { branch: branch.name, path: branch.worktree!.path } },
        { isProtectedBranch: false },
      )
    })

    const cancelButton = findButtonByText('dialog.cancel')
    expect(cancelButton).not.toBeNull()

    await act(async () => {
      cancelButton!.click()
      await Promise.resolve()
    })

    expect(dispatchMocks.runBranchAction).not.toHaveBeenCalled()
    expect(useBranchActionDialogsStore.getState().removeConfirm).toBeNull()
  })

  test('protected branch seeds removeAlsoDeletes off on first open', () => {
    const { repo, branch } = setupRepo()
    const repoView = buildRepo(repo)
    render(<BranchActionDialogHost repo={repoView} branch={branch} />)

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: 'main', payload: { branch: 'main', path: '/tmp/main' } },
        { isProtectedBranch: true },
      )
    })

    const checkboxes = useBranchActionDialogsStore.getState().checkboxStateByBranch[
      `${repo.id}\0main`
    ]
    expect(checkboxes?.removeAlsoDeletes).toBe(false)
  })
})