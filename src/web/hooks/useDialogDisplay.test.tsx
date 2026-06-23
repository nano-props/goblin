// @vitest-environment jsdom

// Unit tests for `useDialogDisplay`. jsdom cannot verify the close-
// animation retention at the host level because Radix's `Presence`
// unmounts immediately when no CSS animation is found; the host-
// level retention is verified by code review (the host's display JSX
// reads from `useDialogDisplay`'s `display`, not from the raw slot).
// This test covers the underlying retention contract directly so that
// the body data — title, message, checkbox state, protected-branch
// hint — stays rendered for the duration of the close animation.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useDialogDisplay } from '#/web/hooks/useDialogDisplay.ts'
import {
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type BranchActionDialogEntry,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-dialog-display-test'
const OTHER_REPO_ID = '/tmp/gbl-dialog-display-test-other'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  resetBranchActionDialogsStore()
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
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

interface HarnessHandle<P> {
  current: ReturnType<typeof useDialogDisplay<P>> | null
  setSlot: (next: BranchActionDialogEntry<P> | null) => void
}

function mountHarness<P>(initial: BranchActionDialogEntry<P> | null): HarnessHandle<P> {
  const handle: HarnessHandle<P> = {
    current: null,
    setSlot: () => {},
  }
  function Harness({ slot }: { slot: BranchActionDialogEntry<P> | null }) {
    handle.current = useDialogDisplay(slot)
    return null
  }
  act(() => {
    root!.render(<Harness slot={initial} />)
  })
  handle.setSlot = (next) => {
    act(() => {
      root!.render(<Harness slot={next} />)
    })
  }
  return handle
}

function setupRepo(): void {
  seedRepoState({
    id: REPO_ID,
    branches: [
      { name: 'main', tracking: null, worktree: null },
      {
        name: 'feature/x',
        tracking: 'origin/feature/x',
        trackingGone: false,
        worktree: null,
      },
      {
        name: 'feature/y',
        tracking: 'origin/feature/y',
        trackingGone: false,
        worktree: { path: '/tmp/y' },
      },
    ],
    selectedBranch: 'main',
  })
}

describe('useDialogDisplay', () => {
  test('returns all-null when the slot has never been open', () => {
    setupRepo()
    const handle = mountHarness<RemoveWorktreeDialogPayload>(null)
    expect(handle.current).toEqual({
      liveCtx: null,
      display: null,
      displayCtx: null,
      displayCheckbox: { removeAlsoDeletes: false, removeAlsoUpstream: false, deleteAlsoUpstream: false },
    })
  })

  test('resolves liveCtx, displayCtx, and the persisted checkbox against the open entry', () => {
    setupRepo()
    const entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> = {
      repoId: REPO_ID,
      branchName: 'feature/y',
      payload: { branch: 'feature/y', path: '/tmp/y' },
    }
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: false })
    })

    const handle = mountHarness(entry)

    expect(handle.current?.display).toEqual(entry)
    expect(handle.current?.liveCtx?.branch.name).toBe('feature/y')
    expect(handle.current?.displayCtx?.branch.name).toBe('feature/y')
    // `removeAlsoDeletes` is seeded true on first open for a
    // non-protected branch (matches `openRemoveWorktreeConfirm`).
    expect(handle.current?.displayCheckbox.removeAlsoDeletes).toBe(true)
  })

  test('regression: display and displayCtx survive after the slot is cleared (close animation retention)', () => {
    // The bug: when the user clicks Confirm/Cancel, the store's
    // `closeDialog` nulls the slot. The body's title, message,
    // checkbox state, and protected-branch conditionals must keep
    // rendering for the duration of the Radix close animation.
    setupRepo()
    const entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> = {
      repoId: REPO_ID,
      branchName: 'feature/y',
      payload: { branch: 'feature/y', path: '/tmp/y' },
    }
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: false })
      useBranchActionDialogsStore.getState().setRemoveAlsoUpstream(REPO_ID, 'feature/y', true)
    })

    const handle = mountHarness(entry)
    expect(handle.current?.display).toEqual(entry)
    expect(handle.current?.displayCheckbox.removeAlsoUpstream).toBe(true)

    // Close the slot. `closeDialog` runs in the store; the harness
    // re-renders with a null slot to simulate what `BranchActionDialogHost`
    // sees on the next render after close.
    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
    })
    handle.setSlot(null)

    // liveCtx follows the slot — null because the slot is null.
    expect(handle.current?.liveCtx).toBeNull()
    // display retains the last entry so the body keeps rendering.
    expect(handle.current?.display).toEqual(entry)
    // displayCtx resolves from the retained display entry.
    expect(handle.current?.displayCtx?.branch.name).toBe('feature/y')
    // displayCheckbox keeps the user's last choice — must NOT
    // visually uncheck during the close animation.
    expect(handle.current?.displayCheckbox.removeAlsoUpstream).toBe(true)
  })

  test('regression: protected-branch flag survives after the slot is cleared', () => {
    // The bug: `removeConfirmProtected` was previously read from the
    // raw slot. After close it would flip to false and the body's
    // structural conditionals (disabled checkbox, hint block,
    // conditional upstream-delete block) would change during the
    // close animation. With retention the flag stays true.
    setupRepo()
    const entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> = {
      repoId: REPO_ID,
      branchName: 'main',
      payload: { branch: 'main', path: '/tmp/main' },
    }
    act(() => {
      useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: true })
    })

    const handle = mountHarness(entry)
    expect(handle.current?.display?.payload.branch).toBe('main')

    // Close the slot and re-render with null. The display entry must
    // still carry the branch name 'main' so the body can derive
    // `PROTECTED_BRANCHES.has('main')` from it.
    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
    })
    handle.setSlot(null)

    expect(handle.current?.display?.payload.branch).toBe('main')
  })

  test('displayCtx becomes null when the retained entry\'s branch is deleted from the repo', () => {
    // If the user opens the dialog for branch X and X is deleted
    // upstream while the dialog is still mounted, the retained
    // display entry still has branchName='feature/x' but the live
    // repo no longer has that branch — displayCtx must become null
    // so the body renders nothing rather than crashing.
    setupRepo()
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'feature/x',
      payload: 'feature/x',
    }
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm(entry)
    })

    const handle = mountHarness(entry)
    expect(handle.current?.displayCtx?.branch.name).toBe('feature/x')

    // Simulate the branch being deleted upstream by mutating the
    // live repos store directly.
    act(() => {
      useReposStore.setState((state) => ({
        repos: {
          ...state.repos,
          [REPO_ID]: {
            ...state.repos[REPO_ID]!,
            data: {
              ...state.repos[REPO_ID]!.data,
              branches: state.repos[REPO_ID]!.data.branches.filter((b) => b.name !== 'feature/x'),
            },
          },
        },
      }))
    })

    expect(handle.current?.display).toEqual(entry)
    expect(handle.current?.liveCtx).toBeNull()
    expect(handle.current?.displayCtx).toBeNull()
  })

  test('displayCheckbox reads the checkbox state for the retained entry, not for the current null slot', () => {
    // Distinct checkboxes per (repoId, branchName). When the slot is
    // null after close, the helper must still return the checkbox
    // state for the last opened entry — otherwise the checkbox would
    // visually reset to all-false during the close animation even
    // though the persisted state is still keyed by the entry.
    seedRepoState({
      id: REPO_ID,
      branches: [{ name: 'main', tracking: null, worktree: null }],
      selectedBranch: 'main',
    })
    seedRepoState({
      id: OTHER_REPO_ID,
      branches: [{ name: 'main', tracking: null, worktree: null }],
      selectedBranch: 'main',
    })

    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'main',
      payload: 'main',
    }
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm(entry)
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(REPO_ID, 'main', true)
    })

    const handle = mountHarness(entry)
    expect(handle.current?.displayCheckbox.deleteAlsoUpstream).toBe(true)

    // Close the slot. The retained entry is still (REPO_ID, 'main'),
    // so the checkbox must stay at true. A different (repoId,
    // branchName) in the map must not leak in either.
    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('deleteConfirm')
      // Seed a different branch's checkbox to make sure the helper
      // doesn't accidentally read a non-retained key.
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(OTHER_REPO_ID, 'main', true)
    })
    handle.setSlot(null)

    expect(handle.current?.displayCheckbox.deleteAlsoUpstream).toBe(true)
    expect(handle.current?.display?.repoId).toBe(REPO_ID)
    expect(handle.current?.display?.branchName).toBe('main')
  })
})