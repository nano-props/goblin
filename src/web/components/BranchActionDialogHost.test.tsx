// @vitest-environment jsdom

import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
  repoPresentationFromQueryForTest,
} from '#/web/test-utils/repo-store.ts'
import { cleanup } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import { dispatchDeleteBranch, dispatchPush, dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import {
  resetBranchActionDialogsStore,
  branchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import type { VNode, VNodeChild } from 'vue'

vi.mock('#/web/hooks/branchActionDispatch.ts', () => ({
  dispatchPush: vi.fn(),
  dispatchDeleteBranch: vi.fn(),
  dispatchRemoveWorktree: vi.fn(),
}))

// Mock ConfirmDialog to record the `title` and `message` props on
// every render, so the close-animation regression tests can observe
// the host's prop choices even when Reka has hidden the dialog
// (jsdom has no exit-animation timing, so the dialog content would
// otherwise vanish as soon as `open` flips to false).
const titlePropsByDialog: Record<string, { title: string; message: unknown }> = {
  pushConfirm: { title: '', message: '' },
  deleteConfirm: { title: '', message: '' },
  forceDeleteConfirm: { title: '', message: '' },
  removeConfirm: { title: '', message: '' },
  forceRemoveConfirm: { title: '', message: '' },
}

vi.mock('#/web/components/ConfirmDialog.tsx', () => ({
  ConfirmDialog: ({
    open,
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean
    title: string
    message: unknown
    confirmLabel: string
    onConfirm: () => void | Promise<unknown>
    onCancel: () => void
  }) => {
    // Identify which of the five slots the host is rendering by
    // matching the confirmLabel. The labels are unique per slot:
    //   push-confirm, delete-branch-confirm, force-delete-unmerged,
    //   remove-worktree-confirm, force-delete-branch-confirm.
    const slotByLabel: Record<string, keyof typeof titlePropsByDialog> = {
      'action.confirm-push-confirm': 'pushConfirm',
      'action.confirm-delete-branch-confirm': 'deleteConfirm',
      'action.confirm-force-delete-unmerged-confirm': 'forceDeleteConfirm',
      'action.confirm-remove-worktree-confirm': 'removeConfirm',
      'action.confirm-force-delete-branch-confirm': 'forceRemoveConfirm',
    }
    const slot = slotByLabel[confirmLabel]
    if (slot) titlePropsByDialog[slot] = { title, message }
    // Mimic the real Reka AlertDialog: only mount the dialog
    // content when `open` is true. The existing integration tests
    // rely on this — they find the Cancel button via
    // `findButtonByText('dialog.cancel')` and the FIRST match in
    // the DOM is the only open dialog's cancel button.
    if (!open) return null
    return (
      <div data-testid={`confirm-dialog-${confirmLabel}`} data-open="true">
        <h2>{title}</h2>
        <div>{message as VNodeChild}</div>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          dialog.cancel
        </button>
      </div>
    )
  },
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-dialog-host-test')

function setupRepo() {
  const worktreePath = '/tmp/dialog-host-worktree'
  const branch = createRepoBranch('feature/host')
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [branch],
    worktrees: [createRepoWorktreeSnapshotForTest(branch.name, worktreePath)],
  })
  return { repo, branch, worktreePath }
}

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  resetBranchActionDialogsStore()
})

afterEach(() => {
  // `cleanup` is also wired by `renderInJsdom` between tests; this
  // explicit call is here for tests that mount/unmount within a single
  // test body.
  cleanup()
})

function render(element: VNode) {
  const result = renderInJsdom(<VueQueryClientScope client={appQueryClient}>{element}</VueQueryClientScope>)
  return {
    ...result,
    rerender: (next: VNode) =>
      result.rerender(<VueQueryClientScope client={appQueryClient}>{next}</VueQueryClientScope>),
  }
}

function findButtonByText(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  return buttons.find((b) => b.textContent?.includes(text)) ?? null
}

function setBranchSnapshotForRepo(repoId: string, branches: ReturnType<typeof createRepoBranch>[]): void {
  const repo = workspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing test repo: ${repoId}`)
  const readModel = repoPresentationFromQueryForTest(repo)
  seedRepoQueryDataForTest(repo, {
    branches,
    currentBranch: readModel.snapshot.current,
    status: readModel.status ?? [],
    worktrees: readModel.snapshot.worktrees,
  })
}

function removeBranchFromReadModel(repoId: string, branchName: string): void {
  const repo = workspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing test repo: ${repoId}`)
  const readModel = repoPresentationFromQueryForTest(repo)
  setBranchSnapshotForRepo(
    repoId,
    readModel.snapshot.branches.filter((branch) => branch.name !== branchName),
  )
}

describe('BranchActionDialogHost', () => {
  test('regression: store state survives a full unmount/remount cycle of the host', async () => {
    const { repo, branch, worktreePath } = setupRepo()

    const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: worktreePath }

    // (a) Caller opens the dialog via the store — this is what
    // `useBranchActions.requestRemoveWorktree` does internally today.
    await flushTestUpdates(() => {
      branchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm({ repoId: repo.id, branchName: branch.name, payload }, { isProtectedBranch: false })
    })

    // Mount the host. Active workspace = (repo, branch).
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // (b) + (c) Unmount + remount — the popover went away and came back.
    await flushTestUpdates(() => {
      cleanup()
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    // (d) Dialog still rendered, store still holds the entry.
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')
    expect(branchActionDialogsStore.getState().removeConfirm?.payload).toEqual(payload)
  })

  test('regression: closeStaleDialogs clears any open dialog whose repo does not match the new active workspace', async () => {
    // Repo A active, open removeConfirm for A/feature/x.
    const { repo: repoA, branch: branchA, worktreePath } = setupRepo()
    const repoBId = workspaceIdForTest('goblin+file:///tmp/goblin-other-repo')
    // Add repoB to the store alongside repoA via seedRepoWithReadModelForTest +
    // setState merge (seedRepoWithReadModelForTest alone would overwrite `repos`).
    seedRepoWithReadModelForTest({ id: repoBId, branches: [createRepoBranch('main')] })
    await flushTestUpdates(() => {
      workspacesStore.setState((state) => ({
        workspaces: { ...state.workspaces, [REPO_ID]: repoA },
        restoredWorkspaceId: REPO_ID,
      }))
    })

    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        {
          repoId: repoA.id,
          branchName: branchA.name,
          payload: { branch: branchA.name, path: worktreePath },
        },
        { isProtectedBranch: false },
      )
    })

    // Mount the host with active = repoA/feature/host. Dialog should render.
    const { rerender } = render(
      <BranchActionDialogHost currentWorkspaceId={repoA.id} currentBranchName={branchA.name} />,
    )
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch the active workspace to repoB. The host's
    // closeStaleDialogs effect fires, which closes the open dialog
    // because (repoA, feature/host) != (repoB, main).
    await rerender(<BranchActionDialogHost currentWorkspaceId={repoBId} currentBranchName="main" />)

    expect(branchActionDialogsStore.getState().removeConfirm).toBeNull()
    expect(document.body.textContent).not.toContain('action.confirm-remove-worktree-title')
  })

  test('regression: closeStaleDialogs clears a dialog whose branch does not match the new current branch', async () => {
    const { repo, branch: branchX, worktreePath } = setupRepo()
    const branchY = createRepoBranch('feature/y')
    setBranchSnapshotForRepo(REPO_ID, [branchX, branchY])

    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        {
          repoId: repo.id,
          branchName: branchX.name,
          payload: { branch: branchX.name, path: worktreePath },
        },
        { isProtectedBranch: false },
      )
    })

    const { rerender } = render(
      <BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branchX.name} />,
    )
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch current route branch in the same repo. The dialog is for X
    // and the new active is Y; closeStaleDialogs should close it.
    await rerender(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branchY.name} />)

    expect(branchActionDialogsStore.getState().removeConfirm).toBeNull()
  })

  // NOTE: Regression coverage for the "dialog content stays rendered
  // during the close animation" fix lives in
  // `useBranchActionDialogDisplay.test.tsx` (the display retention
  // hook that the host calls). A Reka-portal-driven DOM check is
  // not feasible in jsdom — Reka's `Presence` checks
  // `getComputedStyle` for an active animation and sends `UNMOUNT`
  // immediately when none is found, so the dialog unmounts before
  // we can inspect content.

  test("integration: clicking Confirm dispatches against the dialog payload, not the host's active workspace", async () => {
    // The headline contract of this refactor: the user can open a
    // dialog for a non-selected branch row (e.g. a row in the
    // zen-mode HoverCard popover) and the Confirm click dispatches
    // against that branch's data, not the workspace's
    // `(currentWorkspaceId, currentBranchName)`.
    const repoA = setupRepo().repo
    const repoBId = workspaceIdForTest('goblin+file:///tmp/goblin-other-repo')
    seedRepoWithReadModelForTest({ id: repoBId, branches: [createRepoBranch('main')] })
    await flushTestUpdates(() => {
      workspacesStore.setState((state) => ({
        workspaces: { ...state.workspaces, [REPO_ID]: repoA },
        restoredWorkspaceId: REPO_ID,
      }))
    })

    // Mount the host FIRST with workspace = repoA / feature/host. The
    // closeStaleDialogs effect runs on mount and finds no stale
    // dialogs to close (nothing is open yet).
    render(<BranchActionDialogHost currentWorkspaceId={REPO_ID} currentBranchName="feature/host" />)

    // NOW open a delete dialog for repo B's main branch while the
    // workspace is still on repo A — the popover use case. The
    // effect does not re-fire (its deps didn't change), so the
    // dialog stays open.
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repoBId,
        branchName: 'main',
        payload: 'main',
      })
    })

    const confirmButton = findButtonByText('action.confirm-delete-branch-confirm')
    expect(confirmButton).not.toBeNull()
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchDeleteBranch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(dispatchDeleteBranch).mock.calls[0]![0] as {
      repo: { id: string }
      branchName: string
      force: boolean
      deleteUpstream: boolean
    }
    // The dispatch must target repo B and the dialog's branch — NOT
    // the host's active (repoA, feature/host).
    expect(call.repo.id).toBe(repoBId)
    expect(call.branchName).toBe('main')
    expect(call.force).toBe(false)
  })

  test('integration: clicking Confirm forwards the persisted checkbox state to dispatchDeleteBranch', async () => {
    const { repo, branch } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      branchActionDialogsStore.getState().setDeleteAlsoUpstream(repo.id, branch.name, true)
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-delete-branch-confirm')
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchDeleteBranch).toHaveBeenCalledWith(expect.objectContaining({ deleteUpstream: true }))
  })

  test('integration: clicking Confirm on the push-protected dialog calls dispatchPush', async () => {
    const { repo, branch } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openPushConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-push-confirm')
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchPush).toHaveBeenCalledTimes(1)
    const call = vi.mocked(dispatchPush).mock.calls[0]![0] as {
      repo: { id: string }
      branchName: string
    }
    expect(call.repo.id).toBe(repo.id)
    expect(call.branchName).toBe(branch.name)
  })

  test('integration: clicking Confirm on the force-remove-worktree dialog dispatches forceDeleteBranch:true', async () => {
    const { repo, branch, worktreePath } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: { branch: branch.name, path: worktreePath },
      })
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-force-delete-branch-confirm')
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchRemoveWorktree).toHaveBeenCalledTimes(1)
    expect(dispatchRemoveWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        forceDeleteBranch: true,
        deleteBranch: true,
      }),
    )
  })

  test('integration: clicking Cancel closes the slot and does NOT call dispatch', async () => {
    const { repo, branch } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const cancelButton = findButtonByText('dialog.cancel')
    await flushTestUpdates(() => {
      cancelButton!.click()
    })

    expect(dispatchDeleteBranch).not.toHaveBeenCalled()
    expect(branchActionDialogsStore.getState().deleteConfirm).toBeNull()
  })

  test('integration: remove-worktree dialog forwards deleteBranch and deleteUpstream to dispatchRemoveWorktree', async () => {
    const { repo, branch, worktreePath } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm(
          { repoId: repo.id, branchName: branch.name, payload: { branch: branch.name, path: worktreePath } },
          { isProtectedBranch: false },
        )
      branchActionDialogsStore.getState().setRemoveAlsoDeletes(repo.id, branch.name, true)
      branchActionDialogsStore.getState().setRemoveAlsoUpstream(repo.id, branch.name, true)
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-remove-worktree-confirm')
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchRemoveWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteBranch: true,
        deleteUpstream: true,
        forceDeleteBranch: false,
      }),
    )
  })

  test('integration: end-to-end force-promote preserves deleteAlsoUpstream from the regular confirm', async () => {
    // The headline regression from the earlier commit: open
    // deleteConfirm, toggle deleteAlsoUpstream=true, force-promote
    // (openForceDeleteConfirm), click Confirm on the force dialog,
    // and assert the dispatch receives both `force: true` and the
    // user's original `deleteUpstream: true` choice — i.e.
    // force-promote must NOT reset the checkbox state.
    const { repo, branch, worktreePath } = setupRepo()
    await flushTestUpdates(() => {
      branchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      branchActionDialogsStore.getState().setDeleteAlsoUpstream(repo.id, branch.name, true)
      // Simulate the IPC returning "needs force" — the handleResult
      // callback in dispatchDeleteBranch would normally call
      // openForceDeleteConfirm. We do it directly here because the
      // dispatch is mocked.
      branchActionDialogsStore.getState().openForceDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-force-delete-unmerged-confirm')
    await flushTestUpdates(() => {
      confirmButton!.click()
    })

    expect(dispatchDeleteBranch).toHaveBeenCalledTimes(1)
    expect(dispatchDeleteBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        deleteUpstream: true,
      }),
    )
  })

  // The title-flip regression. Pre-fix, the four non-push dialogs
  // used an IIFE that short-circuited to `<ConfirmDialog title=""
  // message="" />` whenever `displayContext` was null. When the
  // backend IPC completes within the Reka close-animation window
  // (~200 ms) and removes the branch from the repo, `displayContext`
  // becomes null while `entry` is still retained. Pre-fix the user
  // saw the title text disappear mid-fade; post-fix the title stays
  // and only the body collapses. Covers all four non-push dialogs.
  //
  // We can't observe the bug through `document.body.textContent`
  // because Reka's `AlertDialog` unmounts its content as soon as
  // `open` flips to false in jsdom (no exit-animation timing). So
  // we mock `ConfirmDialog` to record the `title` prop on every
  // render, letting us assert what the host passed to the dialog
  // even when Reka would have hidden it in the browser.
  describe('retains dialog content when displayContext goes null mid-fade-out', () => {
    async function dropBranchFromRepo(branchName: string): Promise<void> {
      await flushTestUpdates(() => {
        removeBranchFromReadModel(REPO_ID, branchName)
      })
    }

    test('removeConfirm retains its title and body', async () => {
      const { repo, branch, worktreePath } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: worktreePath }
      await flushTestUpdates(() => {
        branchActionDialogsStore
          .getState()
          .openRemoveWorktreeConfirm(
            { repoId: repo.id, branchName: branch.name, payload },
            { isProtectedBranch: false },
          )
      })
      render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)
      // Pre-close: title is the static i18n key.
      expect(titlePropsByDialog.removeConfirm.title).toBe('action.confirm-remove-worktree-title')
      expect(titlePropsByDialog.removeConfirm.message).not.toBe('')

      // Close the slot (entry retained), then drop the branch from
      // the repo so `displayContext` becomes null. The host's
      // render here is the structural one that would have rendered
      // `title=""` under the pre-fix IIFE.
      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().closeDialog('removeConfirm')
      })
      await dropBranchFromRepo(branch.name)

      // Post-fix: title is still the static i18n key. Pre-fix it
      // would be `""`.
      expect(titlePropsByDialog.removeConfirm.title).toBe('action.confirm-remove-worktree-title')
      expect(titlePropsByDialog.removeConfirm.message).not.toBe('')
    })

    test('deleteConfirm retains its title and body', async () => {
      const { repo, branch, worktreePath } = setupRepo()
      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().openDeleteConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload: branch.name,
        })
      })
      render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.deleteConfirm.title).toBe('action.confirm-delete-branch-title')
      expect(titlePropsByDialog.deleteConfirm.message).not.toBe('')

      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().closeDialog('deleteConfirm')
      })
      await dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.deleteConfirm.title).toBe('action.confirm-delete-branch-title')
      expect(titlePropsByDialog.deleteConfirm.message).not.toBe('')
    })

    test('forceDeleteConfirm retains its title and body', async () => {
      const { repo, branch, worktreePath } = setupRepo()
      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().openForceDeleteConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload: branch.name,
        })
      })
      render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.forceDeleteConfirm.title).toBe('action.confirm-force-delete-unmerged-title')
      expect(titlePropsByDialog.forceDeleteConfirm.message).not.toBe('')

      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().closeDialog('forceDeleteConfirm')
      })
      await dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.forceDeleteConfirm.title).toBe('action.confirm-force-delete-unmerged-title')
      expect(titlePropsByDialog.forceDeleteConfirm.message).not.toBe('')
    })

    test('forceRemoveConfirm retains its title and body', async () => {
      const { repo, branch, worktreePath } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: worktreePath }
      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload,
        })
      })
      render(<BranchActionDialogHost currentWorkspaceId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.forceRemoveConfirm.title).toBe('action.confirm-force-delete-branch-title')
      expect(titlePropsByDialog.forceRemoveConfirm.message).not.toBe('')

      await flushTestUpdates(() => {
        branchActionDialogsStore.getState().closeDialog('forceRemoveConfirm')
      })
      await dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.forceRemoveConfirm.title).toBe('action.confirm-force-delete-branch-title')
      expect(titlePropsByDialog.forceRemoveConfirm.message).not.toBe('')
    })
  })
})
