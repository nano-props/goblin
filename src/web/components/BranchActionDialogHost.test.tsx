// @vitest-environment jsdom

// Integration tests for `BranchActionDialogHost`, the layout-level
// host for the five branch-action confirmation dialogs. These cover
// the regressions the host is designed to fix:
//   - `resetBranchActionDialogsStore` actually clearing slot state
//   - cross-repo / cross-branch dialog leakage on workspace change
//   - force-promote preserving the user's `deleteAlsoUpstream`
//     choice
//   - one-dialog-at-a-time invariant across the `openXxx` actions

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchActionDialogHost } from '#/web/components/BranchActionDialogHost.tsx'
import {
  branchCheckboxKey,
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { idleOperation } from '#/web/stores/repos/operations.ts'

const dispatchMocks = vi.hoisted(() => ({
  runBranchAction: vi.fn((_id: string, _action: { kind: string }) => Promise.resolve({ ok: true, message: 'ok' })),
}))

vi.mock('#/web/hooks/branchActionDispatch.ts', () => ({
  dispatchConfirmPush: vi.fn(),
  dispatchDeleteBranch: vi.fn(),
  dispatchRemoveWorktree: vi.fn(),
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

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

function render(element: React.ReactNode) {
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
    const { repo, branch } = setupRepo()
    buildRepo(repo)

    const payload: RemoveWorktreeDialogPayload = { branch: branch.name, path: branch.worktree!.path }

    // (a) Caller opens the dialog via the store — this is what
    // `useBranchActions.requestRemoveWorktree` does internally today.
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: branch.name, payload },
        { isProtectedBranch: false },
      )
    })

    // Mount the host. Active workspace = (repo, branch).
    render(<BranchActionDialogHost activeRepoId={repo.id} activeBranchName={branch.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // (b) + (c) Unmount + remount — the popover went away and came back.
    act(() => {
      root!.unmount()
    })
    root = createRoot(container!)
    render(<BranchActionDialogHost activeRepoId={repo.id} activeBranchName={branch.name} />)

    // (d) Dialog still rendered, store still holds the entry.
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')
    expect(useBranchActionDialogsStore.getState().removeConfirm?.payload).toEqual(payload)
  })

  test('regression: closeStaleDialogs clears any open dialog whose repo does not match the new active workspace', () => {
    // Repo A active, open removeConfirm for A/feature/x.
    const { repo: repoA, branch: branchA } = setupRepo()
    const repoBId = '/tmp/gbl-other-repo'
    // Add repoB to the store alongside repoA via seedRepoState +
    // setState merge (seedRepoState alone would overwrite `repos`).
    seedRepoState({ id: repoBId, branches: [createRepoBranch('main')] })
    act(() => {
      useReposStore.setState((state) => ({
        repos: { ...state.repos, [REPO_ID]: repoA },
        activeId: REPO_ID,
      }))
    })

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repoA.id, branchName: branchA.name, payload: { branch: branchA.name, path: branchA.worktree!.path } },
        { isProtectedBranch: false },
      )
    })

    // Mount the host with active = repoA/feature/host. Dialog should render.
    render(<BranchActionDialogHost activeRepoId={repoA.id} activeBranchName={branchA.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch the active workspace to repoB. The host's
    // closeStaleDialogs effect fires, which closes the open dialog
    // because (repoA, feature/host) != (repoB, main).
    act(() => {
      root!.unmount()
    })
    root = createRoot(container!)
    render(<BranchActionDialogHost activeRepoId={repoBId} activeBranchName="main" />)

    expect(useBranchActionDialogsStore.getState().removeConfirm).toBeNull()
    expect(document.body.textContent).not.toContain('action.confirm-remove-worktree-title')
  })

  test('regression: closeStaleDialogs clears a dialog whose branch does not match the new selected branch', () => {
    const { repo, branch: branchX } = setupRepo()
    const branchY = createRepoBranch('feature/y', { worktree: { path: '/tmp/y' } })
    // Add branchY to the same repo.
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [REPO_ID]: {
          ...state.repos[REPO_ID]!,
          data: { ...state.repos[REPO_ID]!.data, branches: [...state.repos[REPO_ID]!.data.branches, branchY] },
        },
      },
    }))

    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: branchX.name, payload: { branch: branchX.name, path: branchX.worktree!.path } },
        { isProtectedBranch: false },
      )
    })

    render(<BranchActionDialogHost activeRepoId={repo.id} activeBranchName={branchX.name} />)
    expect(document.body.textContent).toContain('action.confirm-remove-worktree-title')

    // Switch selected branch in the same repo. The dialog is for X
    // and the new active is Y; closeStaleDialogs should close it.
    act(() => {
      root!.unmount()
    })
    root = createRoot(container!)
    render(<BranchActionDialogHost activeRepoId={repo.id} activeBranchName={branchY.name} />)

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

  test('regression: force-promote preserves the user\'s deleteAlsoUpstream choice', () => {
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
    const checkboxes = useBranchActionDialogsStore.getState().checkboxStateByBranch[
      branchCheckboxKey(repo.id, branch.name)
    ]
    expect(checkboxes?.deleteAlsoUpstream).toBe(true)
  })

  test('protected branch seeds removeAlsoDeletes off on first open', () => {
    const { repo } = setupRepo()
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
        { repoId: repo.id, branchName: 'main', payload: { branch: 'main', path: '/tmp/main' } },
        { isProtectedBranch: true },
      )
    })
    const checkboxes = useBranchActionDialogsStore.getState().checkboxStateByBranch[
      branchCheckboxKey(repo.id, 'main')
    ]
    expect(checkboxes?.removeAlsoDeletes).toBe(false)
  })

  // NOTE: Regression coverage for the "dialog content stays rendered
  // during the close animation" fix lives in `useLastNonNull.test.tsx`
  // (the display retention hook). A Radix-portal-driven DOM check is
  // not feasible in jsdom — Radix's `Presence` checks `getComputedStyle`
  // for an active animation and sends `UNMOUNT` immediately when none
  // is found, so the dialog unmounts before we can inspect content.
})
