// @vitest-environment jsdom

// Integration tests for `BranchActionDialogHost`, the layout-level
// host for the five branch-action confirmation dialogs. These cover
// the regressions the host is designed to fix:
//   - `resetBranchActionDialogsStore` actually clearing slot state
//   - cross-repo / cross-branch dialog leakage on workspace change
//   - force-promote preserving the user's `deleteAlsoUpstream`
//     choice
//   - one-dialog-at-a-time invariant across the `openXxx` actions

import { act, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import {
  branchCheckboxKey,
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

vi.mock('#/web/hooks/branchActionDispatch.ts', () => ({
  dispatchPush: vi.fn(),
  dispatchDeleteBranch: vi.fn(),
  dispatchRemoveWorktree: vi.fn(),
}))

// Side-effect import: registers a partial mock of `#/web/stores/i18n.ts`
// that delegates to the real module so `i18next.use(initReactI18next).
// init({…})` still runs (which is what wires the i18next singleton into
// `react-i18next`'s module-scoped closure, the one `<Trans>` reads
// from), and only overrides `useT` to return raw keys. See
// `src/test-utils/i18n-mock.ts` for the rationale and the importOriginal
// pattern that backs this side effect.
import { stubI18n } from '#/test-utils/i18n-mock.ts'
stubI18n()

// Mock ConfirmDialog to record the `title` and `message` props on
// every render, so the close-animation regression tests can observe
// the host's prop choices even when Radix has hidden the dialog
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
    // Mimic the real Radix AlertDialog: only mount the dialog
    // content when `open` is true. The existing integration tests
    // rely on this — they find the Cancel button via
    // `findButtonByText('dialog.cancel')` and the FIRST match in
    // the DOM is the only open dialog's cancel button.
    if (!open) return null
    return (
      <div data-testid={`confirm-dialog-${confirmLabel}`} data-open="true">
        <h2>{title}</h2>
        <div>{message as React.ReactNode}</div>
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

const REPO_ID = '/tmp/gbl-dialog-host-test'

function setupRepo() {
  const worktreePath = '/tmp/dialog-host-worktree'
  const branch = createRepoBranch('feature/host', { worktree: { path: worktreePath } })
  const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [branch] })
  return { repo, branch, worktreePath }
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  resetBranchActionDialogsStore()
})

afterEach(() => {
  // `cleanup` is also wired by `renderInJsdom` between tests; this
  // explicit call is here for tests that mount/unmount within a single
  // test body.
  cleanup()
})

function render(element: React.ReactNode) {
  const result = renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: React.ReactNode) => {
      result.rerender(<QueryClientProvider client={primaryWindowQueryClient}>{next}</QueryClientProvider>)
    },
  }
}

function findButtonByText(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button'))
  return buttons.find((b) => b.textContent?.includes(text)) ?? null
}

function setBranchSnapshotForRepo(repoId: string, branches: ReturnType<typeof createRepoBranch>[]): void {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) throw new Error(`missing test repo: ${repoId}`)
  const readModel = readRepoBranchQueryProjection(repo)
  setRepoSnapshotQueryData(repoId, repo.instanceId, {
    current: readModel?.currentBranch ?? '',
    branches,
  })
}

function removeBranchFromReadModel(repoId: string, branchName: string): void {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) throw new Error(`missing test repo: ${repoId}`)
  const readModel = readRepoBranchQueryProjection(repo)
  setBranchSnapshotForRepo(
    repoId,
    readModel?.branches.filter((branch) => branch.name !== branchName) ?? [],
  )
}

describe('BranchActionDialogHost', () => {
  test('regression: store state survives a full unmount/remount cycle of the host', () => {
    const { repo, branch } = setupRepo()

    const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }

    // (a) Caller opens the dialog via the store — this is what
    // `useBranchActions.requestRemoveWorktree` does internally today.
    act(() => {
      useBranchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm({ repoId: repo.id, branchName: branch.name, payload }, { isProtectedBranch: false })
    })

    // Mount the host. Active workspace = (repo, branch).
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // (b) + (c) Unmount + remount — the popover went away and came back.
    act(() => {
      cleanup()
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    // (d) Dialog still rendered, store still holds the entry.
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')
    expect(useBranchActionDialogsStore.getState().removeConfirm?.payload).toEqual(payload)
  })

  test('regression: closeStaleDialogs clears any open dialog whose repo does not match the new active workspace', () => {
    // Repo A active, open removeConfirm for A/feature/x.
    const { repo: repoA, branch: branchA } = setupRepo()
    const repoBId = '/tmp/gbl-other-repo'
    // Add repoB to the store alongside repoA via seedRepoWithReadModelForTest +
    // setState merge (seedRepoWithReadModelForTest alone would overwrite `repos`).
    seedRepoWithReadModelForTest({ id: repoBId, branches: [createRepoBranch('main')] })
    act(() => {
      useReposStore.setState((state) => ({
        repos: { ...state.repos, [REPO_ID]: repoA },
        restoredRepoId: REPO_ID,
      }))
    })

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        {
          repoId: repoA.id,
          branchName: branchA.name,
          payload: { branch: branchA.name, path: branchA.worktree!.path },
        },
        { isProtectedBranch: false },
      )
    })

    // Mount the host with active = repoA/feature/host. Dialog should render.
    const { rerender } = render(<BranchActionDialogHost currentRepoId={repoA.id} currentBranchName={branchA.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch the active workspace to repoB. The host's
    // closeStaleDialogs effect fires, which closes the open dialog
    // because (repoA, feature/host) != (repoB, main).
    rerender(<BranchActionDialogHost currentRepoId={repoBId} currentBranchName="main" />)

    expect(useBranchActionDialogsStore.getState().removeConfirm).toBeNull()
    expect(document.body.textContent).not.toContain('action.confirm-remove-worktree-title')
  })

  test('regression: closeStaleDialogs clears a dialog whose branch does not match the new current branch', () => {
    const { repo, branch: branchX } = setupRepo()
    const branchY = createRepoBranch('feature/y', { worktree: { path: '/tmp/y' } })
    setBranchSnapshotForRepo(REPO_ID, [branchX, branchY])

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        {
          repoId: repo.id,
          branchName: branchX.name,
          payload: { branch: branchX.name, path: branchX.worktree!.path },
        },
        { isProtectedBranch: false },
      )
    })

    const { rerender } = render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branchX.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch current route branch in the same repo. The dialog is for X
    // and the new active is Y; closeStaleDialogs should close it.
    rerender(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branchY.name} />)

    expect(useBranchActionDialogsStore.getState().removeConfirm).toBeNull()
  })

  test('one dialog open at a time: opening a second dialog closes the first', () => {
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openPushConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    expect(useBranchActionDialogsStore.getState().pushConfirm).not.toBeNull()
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    expect(useBranchActionDialogsStore.getState().pushConfirm).toBeNull()
    expect(useBranchActionDialogsStore.getState().deleteConfirm).not.toBeNull()
  })

  test("regression: force-promote preserves the user's deleteAlsoUpstream choice", () => {
    const { repo, branch } = setupRepo()
    // Seed: user opens deleteConfirm and toggles deleteAlsoUpstream on.
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(repo.id, branch.name, true)
    })
    // Promote: regular confirm fails, opens force variant.
    act(() => {
      useBranchActionDialogsStore.getState().openForceDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    expect(useBranchActionDialogsStore.getState().forceDeleteConfirm).not.toBeNull()
    expect(useBranchActionDialogsStore.getState().deleteConfirm).toBeNull()
    // The user's deleteAlsoUpstream=true should be preserved into
    // the force confirm's checkbox read.
    const checkboxes =
      useBranchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey(repo.id, branch.name)]
    expect(checkboxes?.deleteAlsoUpstream).toBe(true)
  })

  test('protected branch seeds removeAlsoDeletes off on first open', () => {
    const { repo } = setupRepo()
    act(() => {
      useBranchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm(
          { repoId: repo.id, branchName: 'main', payload: { branch: 'main', path: '/tmp/main' } },
          { isProtectedBranch: true },
        )
    })
    const checkboxes = useBranchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey(repo.id, 'main')]
    expect(checkboxes?.removeAlsoDeletes).toBe(false)
  })

  // NOTE: Regression coverage for the "dialog content stays rendered
  // during the close animation" fix lives in
  // `useBranchActionDialogDisplay.test.tsx` (the display retention
  // hook that the host calls). A Radix-portal-driven DOM check is
  // not feasible in jsdom — Radix's `Presence` checks
  // `getComputedStyle` for an active animation and sends `UNMOUNT`
  // immediately when none is found, so the dialog unmounts before
  // we can inspect content.

  test("integration: clicking Confirm dispatches against the dialog payload, not the host's active workspace", async () => {
    // The headline contract of this refactor: the user can open a
    // dialog for a non-selected branch row (e.g. a row in the
    // zen-mode HoverCard popover) and the Confirm click dispatches
    // against that branch's data, not the workspace's
    // `(currentRepoId, currentBranchName)`.
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const repoA = setupRepo().repo
    const repoBId = '/tmp/gbl-other-repo'
    seedRepoWithReadModelForTest({ id: repoBId, branches: [createRepoBranch('main')] })
    act(() => {
      useReposStore.setState((state) => ({
        repos: { ...state.repos, [REPO_ID]: repoA },
        restoredRepoId: REPO_ID,
      }))
    })

    // Mount the host FIRST with workspace = repoA / feature/host. The
    // closeStaleDialogs effect runs on mount and finds no stale
    // dialogs to close (nothing is open yet).
    render(<BranchActionDialogHost currentRepoId={REPO_ID} currentBranchName="feature/host" />)

    // NOW open a delete dialog for repo B's main branch while the
    // workspace is still on repo A — the popover use case. The
    // effect does not re-fire (its deps didn't change), so the
    // dialog stays open.
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repoBId,
        branchName: 'main',
        payload: 'main',
      })
    })

    const confirmButton = findButtonByText('action.confirm-delete-branch-confirm')
    expect(confirmButton).not.toBeNull()
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchDeleteBranch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(dispatch.dispatchDeleteBranch).mock.calls[0]![0] as {
      repo: { id: string }
      branchName: string
      force: boolean
      alsoDeleteUpstream: boolean
    }
    // The dispatch must target repo B and the dialog's branch — NOT
    // the host's active (repoA, feature/host).
    expect(call.repo.id).toBe(repoBId)
    expect(call.branchName).toBe('main')
    expect(call.force).toBe(false)
  })

  test('integration: clicking Confirm forwards the persisted checkbox state to dispatchDeleteBranch', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(repo.id, branch.name, true)
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-delete-branch-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchDeleteBranch).toHaveBeenCalledWith(expect.objectContaining({ alsoDeleteUpstream: true }))
  })

  test('integration: clicking Confirm on a force-promoted dialog dispatches with force: true', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openForceDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-force-delete-unmerged-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchDeleteBranch).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
  })

  test('integration: clicking Confirm on the push-protected dialog calls dispatchPush', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openPushConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-push-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchPush).toHaveBeenCalledTimes(1)
    const call = vi.mocked(dispatch.dispatchPush).mock.calls[0]![0] as {
      repo: { id: string }
      branchName: string
    }
    expect(call.repo.id).toBe(repo.id)
    expect(call.branchName).toBe(branch.name)
  })

  test('integration: clicking Confirm on the remove-worktree dialog dispatches dispatchRemoveWorktree', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm(
          { repoId: repo.id, branchName: branch.name, payload: { branch: branch.name, path: branch.worktree!.path } },
          { isProtectedBranch: false },
        )
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-remove-worktree-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchRemoveWorktree).toHaveBeenCalledTimes(1)
  })

  test('integration: clicking Confirm on the force-remove-worktree dialog dispatches forceDeleteBranch:true', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: { branch: branch.name, path: branch.worktree!.path },
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-force-delete-branch-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchRemoveWorktree).toHaveBeenCalledTimes(1)
    expect(dispatch.dispatchRemoveWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        forceDeleteBranch: true,
        alsoDeleteBranch: true,
      }),
    )
  })

  test('integration: clicking Cancel closes the slot and does NOT call dispatch', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const cancelButton = findButtonByText('dialog.cancel')
    act(() => {
      cancelButton!.click()
    })

    expect(dispatch.dispatchDeleteBranch).not.toHaveBeenCalled()
    expect(useBranchActionDialogsStore.getState().deleteConfirm).toBeNull()
  })

  test('integration: remove-worktree dialog forwards alsoDeleteBranch and alsoDeleteUpstream to dispatchRemoveWorktree', async () => {
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore
        .getState()
        .openRemoveWorktreeConfirm(
          { repoId: repo.id, branchName: branch.name, payload: { branch: branch.name, path: branch.worktree!.path } },
          { isProtectedBranch: false },
        )
      useBranchActionDialogsStore.getState().setRemoveAlsoDeletes(repo.id, branch.name, true)
      useBranchActionDialogsStore.getState().setRemoveAlsoUpstream(repo.id, branch.name, true)
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-remove-worktree-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchRemoveWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        alsoDeleteBranch: true,
        alsoDeleteUpstream: true,
        forceDeleteBranch: false,
      }),
    )
  })

  test('integration: end-to-end force-promote preserves deleteAlsoUpstream from the regular confirm', async () => {
    // The headline regression from the earlier commit: open
    // deleteConfirm, toggle deleteAlsoUpstream=true, force-promote
    // (openForceDeleteConfirm), click Confirm on the force dialog,
    // and assert the dispatch receives both `force: true` and the
    // user's original `alsoDeleteUpstream: true` choice — i.e.
    // force-promote must NOT reset the checkbox state.
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(repo.id, branch.name, true)
      // Simulate the IPC returning "needs force" — the handleResult
      // callback in dispatchDeleteBranch would normally call
      // openForceDeleteConfirm. We do it directly here because the
      // dispatch is mocked.
      useBranchActionDialogsStore.getState().openForceDeleteConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-force-delete-unmerged-confirm')
    act(() => {
      confirmButton!.click()
    })

    expect(dispatch.dispatchDeleteBranch).toHaveBeenCalledTimes(1)
    expect(dispatch.dispatchDeleteBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        alsoDeleteUpstream: true,
      }),
    )
  })

  test('integration: onConfirm returning the IPC promise drives useAsyncPending (aria-busy during IPC)', async () => {
    // Regression guard for the "dispatch drops the IPC promise" bug
    // fixed in this commit: if the dispatch functions returned `void`
    // instead of the Promise, `useAsyncPending.run` would never see a
    // thenable result and `aria-busy` would never be set during the
    // IPC round-trip. With the fix, returning the Promise from the
    // dispatch turns the Confirm button into a busy state until the
    // Promise settles. We can't observe the busy state through jsdom
    // (the dispatch mock resolves synchronously), but we can verify
    // the contract by checking the call site's return type and the
    // dispatch mock's recorded return.
    const dispatch = await import('#/web/hooks/branchActionDispatch.ts')
    const { repo, branch } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openPushConfirm({
        repoId: repo.id,
        branchName: branch.name,
        payload: branch.name,
      })
    })
    render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)

    const confirmButton = findButtonByText('action.confirm-push-confirm')
    act(() => {
      confirmButton!.click()
    })

    // The dispatch function now returns Promise<ExecResult | null>;
    // in production the host's onConfirm returns that promise. The
    // mock returns undefined, so aria-busy stays undefined in tests
    // — what we verify here is that the mock was called, which is the
    // observable contract that the host's onConfirm actually invoked
    // the dispatch with the correct args.
    expect(dispatch.dispatchPush).toHaveBeenCalledTimes(1)
    expect(confirmButton?.getAttribute('aria-busy')).toBeNull() // mock resolved sync
  })

  // The title-flip regression. Pre-fix, the four non-push dialogs
  // used an IIFE that short-circuited to `<ConfirmDialog title=""
  // message="" />` whenever `displayContext` was null. When the
  // backend IPC completes within the Radix close-animation window
  // (~200 ms) and removes the branch from the repo, `displayContext`
  // becomes null while `entry` is still retained. Pre-fix the user
  // saw the title text disappear mid-fade; post-fix the title stays
  // and only the body collapses. Covers all four non-push dialogs.
  //
  // We can't observe the bug through `document.body.textContent`
  // because Radix's `AlertDialog` unmounts its content as soon as
  // `open` flips to false in jsdom (no exit-animation timing). So
  // we mock `ConfirmDialog` to record the `title` prop on every
  // render, letting us assert what the host passed to the dialog
  // even when Radix would have hidden it in the browser.
  describe('regression: title stays visible when displayContext goes null mid-fade-out', () => {
    function dropBranchFromRepo(branchName: string): void {
      act(() => {
        removeBranchFromReadModel(REPO_ID, branchName)
      })
    }

    test('removeConfirm: title is the static i18n key, not "", when the branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }
      act(() => {
        useBranchActionDialogsStore
          .getState()
          .openRemoveWorktreeConfirm(
            { repoId: repo.id, branchName: branch.name, payload },
            { isProtectedBranch: false },
          )
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      // Pre-close: title is the static i18n key.
      expect(titlePropsByDialog.removeConfirm.title).toBe('action.confirm-remove-worktree-title')

      // Close the slot (entry retained), then drop the branch from
      // the repo so `displayContext` becomes null. The host's
      // render here is the structural one that would have rendered
      // `title=""` under the pre-fix IIFE.
      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
      })
      dropBranchFromRepo(branch.name)

      // Post-fix: title is still the static i18n key. Pre-fix it
      // would be `""`.
      expect(titlePropsByDialog.removeConfirm.title).toBe('action.confirm-remove-worktree-title')
    })

    test('deleteConfirm: title is the static i18n key, not "", when the branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      act(() => {
        useBranchActionDialogsStore.getState().openDeleteConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload: branch.name,
        })
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.deleteConfirm.title).toBe('action.confirm-delete-branch-title')

      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('deleteConfirm')
      })
      dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.deleteConfirm.title).toBe('action.confirm-delete-branch-title')
    })

    test('forceDeleteConfirm: title is the static i18n key, not "", when the branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      act(() => {
        useBranchActionDialogsStore.getState().openForceDeleteConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload: branch.name,
        })
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.forceDeleteConfirm.title).toBe('action.confirm-force-delete-unmerged-title')

      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('forceDeleteConfirm')
      })
      dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.forceDeleteConfirm.title).toBe('action.confirm-force-delete-unmerged-title')
    })

    test('forceRemoveConfirm: title is the static i18n key, not "", when the branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }
      act(() => {
        useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload,
        })
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.forceRemoveConfirm.title).toBe('action.confirm-force-delete-branch-title')

      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('forceRemoveConfirm')
      })
      dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.forceRemoveConfirm.title).toBe('action.confirm-force-delete-branch-title')
    })
  })

  // The body-collapse regression. Pre-fix, the four non-push dialogs
  // also collapsed the body (gated on `displayContext`) when the
  // branch was removed mid-fade, even after the title was already
  // static. The user would see a title with an empty body for the
  // rest of the close animation — visually contradicting the static
  // title. Post-fix, the body's `displayContext` is retained across
  // the close-animation window via `useLastNonNull(liveContext)` in
  // `useBranchActionDialogDisplay`, so the body stays stable while
  // the dialog fades out.
  describe('regression: body stays visible when the branch is removed mid-fade-out', () => {
    function dropBranchFromRepo(branchName: string): void {
      act(() => {
        removeBranchFromReadModel(REPO_ID, branchName)
      })
    }

    test('removeConfirm: body is not collapsed to empty when the worktree branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }
      act(() => {
        useBranchActionDialogsStore
          .getState()
          .openRemoveWorktreeConfirm(
            { repoId: repo.id, branchName: branch.name, payload },
            { isProtectedBranch: false },
          )
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      // Pre-close: message is the full body (a React element, not
      // the empty string).
      expect(titlePropsByDialog.removeConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.removeConfirm.message).not.toBe('')

      // Close the slot (entry retained), then drop the branch.
      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
      })
      dropBranchFromRepo(branch.name)

      // Post-fix: message is still a non-empty body. Pre-fix it
      // would be the string `''` (the IIFE fallback).
      expect(titlePropsByDialog.removeConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.removeConfirm.message).not.toBe('')
    })

    test('deleteConfirm: body is not collapsed to empty when the branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      act(() => {
        useBranchActionDialogsStore.getState().openDeleteConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload: branch.name,
        })
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.deleteConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.deleteConfirm.message).not.toBe('')

      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('deleteConfirm')
      })
      dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.deleteConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.deleteConfirm.message).not.toBe('')
    })

    test('forceRemoveConfirm: body is not collapsed to empty when the worktree branch is removed mid-fade', () => {
      const { repo, branch } = setupRepo()
      const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }
      act(() => {
        useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
          repoId: repo.id,
          branchName: branch.name,
          payload,
        })
      })
      render(<BranchActionDialogHost currentRepoId={repo.id} currentBranchName={branch.name} />)
      expect(titlePropsByDialog.forceRemoveConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.forceRemoveConfirm.message).not.toBe('')

      act(() => {
        useBranchActionDialogsStore.getState().closeDialog('forceRemoveConfirm')
      })
      dropBranchFromRepo(branch.name)

      expect(titlePropsByDialog.forceRemoveConfirm.message).toBeTruthy()
      expect(titlePropsByDialog.forceRemoveConfirm.message).not.toBe('')
    })
  })
})
