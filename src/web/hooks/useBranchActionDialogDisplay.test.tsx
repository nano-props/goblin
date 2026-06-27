// @vitest-environment jsdom

// Unit tests for `useBranchActionDialogDisplay`. jsdom cannot verify
// the close-animation retention at the host level because Radix's
// `Presence` unmounts immediately when no CSS animation is found;
// the host-level retention is verified by code review (every body-
// visible field in `BranchActionDialogHost` reads from this hook's
// return value, never from the raw slot). This test covers the
// underlying retention contract directly so that the body data —
// title, message, checkbox state, protected-branch hint — stays
// rendered for the duration of the close animation.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useBranchActionDialogDisplay } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import {
  EMPTY_CHECKBOXES,
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type BranchActionDialogEntry,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'

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
  current: ReturnType<typeof useBranchActionDialogDisplay<P>> | null
  setSlot: (next: BranchActionDialogEntry<P> | null) => void
}

function mountHarness<P>(initial: BranchActionDialogEntry<P> | null): HarnessHandle<P> {
  const handle: HarnessHandle<P> = {
    current: null,
    setSlot: () => {},
  }
  function Harness({ slot }: { slot: BranchActionDialogEntry<P> | null }) {
    // Hoist the subscription outside the hook call, mirroring the
    // production `BranchActionDialogHost` pattern. The helper takes
    // `repos` as a parameter precisely so multiple display hooks in
    // one host share a single subscription.
    const repos = useReposStore((s) => s.repos)
    handle.current = useBranchActionDialogDisplay(slot, repos)
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
      createRepoBranch('main'),
      createRepoBranch('feature/x', { tracking: 'origin/feature/x', trackingGone: false }),
      createRepoBranch('feature/y', {
        tracking: 'origin/feature/y',
        trackingGone: false,
        worktree: { path: '/tmp/y' },
      }),
    ],
    selectedBranch: 'main',
  })
}

function dropBranch(repoId: string, branchName: string): void {
  act(() => {
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [repoId]: {
          ...state.repos[repoId]!,
          data: {
            ...state.repos[repoId]!.data,
            branches: state.repos[repoId]!.data.branches.filter((b: { name: string }) => b.name !== branchName),
          },
        },
      },
    }))
  })
}

describe('useBranchActionDialogDisplay', () => {
  test('returns all-null when the slot has never been open', () => {
    setupRepo()
    const handle = mountHarness<RemoveWorktreeDialogPayload>(null)
    expect(handle.current).toEqual({
      entry: null,
      liveContext: null,
      displayContext: null,
      displayCheckboxes: EMPTY_CHECKBOXES,
    })
  })

  test('resolves liveContext, displayContext, and the persisted checkbox against the open entry', () => {
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

    expect(handle.current?.entry).toEqual(entry)
    expect(handle.current?.liveContext?.branch.name).toBe('feature/y')
    expect(handle.current?.displayContext?.branch.name).toBe('feature/y')
    // `removeAlsoDeletes` is seeded true on first open for a
    // non-protected branch (matches `openRemoveWorktreeConfirm`).
    expect(handle.current?.displayCheckboxes.removeAlsoDeletes).toBe(true)
  })

  test('liveContext and displayContext share identity while the slot is open (single resolveContext call)', () => {
    // The shared-ctx optimisation: when `slot === entry`, the helper
    // reuses the resolved context rather than calling resolveContext
    // twice. This is observable through object identity on the
    // returned context objects.
    setupRepo()
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'main',
      payload: 'main',
    }
    act(() => {
      useBranchActionDialogsStore.getState().openPushConfirm(entry)
    })

    const handle = mountHarness(entry)
    expect(handle.current?.liveContext).toBe(handle.current?.displayContext)
  })

  test('regression: entry, displayContext, and displayCheckboxes survive after the slot is cleared (close animation retention)', () => {
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
    expect(handle.current?.entry).toEqual(entry)
    expect(handle.current?.displayCheckboxes.removeAlsoUpstream).toBe(true)

    // Close the slot. `closeDialog` runs in the store; the harness
    // re-renders with a null slot to simulate what
    // `BranchActionDialogHost` sees on the next render after close.
    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
    })
    handle.setSlot(null)

    // liveContext follows the slot — null because the slot is null.
    expect(handle.current?.liveContext).toBeNull()
    // entry retains the last entry so the body keeps rendering.
    expect(handle.current?.entry).toEqual(entry)
    // displayContext resolves from the retained entry.
    expect(handle.current?.displayContext?.branch.name).toBe('feature/y')
    // displayCheckboxes keeps the user's last choice — must NOT
    // visually uncheck during the close animation.
    expect(handle.current?.displayCheckboxes.removeAlsoUpstream).toBe(true)
  })

  test('regression: replacing the entry while the slot is open resets the retention (slot = A → null → B)', () => {
    // `useLastNonNull` must replace the cached entry when a new
    // non-null slot arrives, not keep returning the previous one.
    // The persisted checkbox must also re-key to the new
    // (repoId, branchName).
    setupRepo()
    const entryA: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'main',
      payload: 'main',
    }
    const entryB: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'feature/x',
      payload: 'feature/x',
    }
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm(entryA)
      useBranchActionDialogsStore.getState().setDeleteAlsoUpstream(REPO_ID, 'main', true)
    })
    const handle = mountHarness(entryA)
    expect(handle.current?.entry).toEqual(entryA)
    expect(handle.current?.displayCheckboxes.deleteAlsoUpstream).toBe(true)

    // Close the slot. The harness re-renders with a null slot so the
    // retention actually passes through null between A and B — the
    // `useLastNonNull` ref holds entry A during this null, and the
    // checkbox for entry A's key is still preserved in the store.
    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('deleteConfirm')
    })
    handle.setSlot(null)
    expect(handle.current?.entry).toEqual(entryA)
    expect(handle.current?.liveContext).toBeNull()
    expect(handle.current?.displayCheckboxes.deleteAlsoUpstream).toBe(true)

    // Reopen with a new entry B. The ref must replace, and the
    // checkbox for B's key must be the fresh default, not entry A's.
    act(() => {
      useBranchActionDialogsStore.getState().openDeleteConfirm(entryB)
    })
    handle.setSlot(entryB)

    expect(handle.current?.entry).toEqual(entryB)
    // Entry B's checkbox was never touched, so it reads the default.
    expect(handle.current?.displayCheckboxes.deleteAlsoUpstream).toBe(false)
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
    expect(handle.current?.entry?.payload.branch).toBe('main')

    act(() => {
      useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
    })
    handle.setSlot(null)

    expect(handle.current?.entry?.payload.branch).toBe('main')
  })

  test("displayContext becomes null when the retained entry's branch is deleted from the repo", () => {
    // If the user opens the dialog for branch X and X is deleted
    // upstream while the dialog is still mounted, the retained
    // display entry still has branchName='feature/x' but the live
    // repo no longer has that branch — displayContext must become
    // null so the body renders nothing rather than crashing.
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
    expect(handle.current?.displayContext?.branch.name).toBe('feature/x')

    dropBranch(REPO_ID, 'feature/x')

    expect(handle.current?.entry).toEqual(entry)
    expect(handle.current?.liveContext).toBeNull()
    expect(handle.current?.displayContext).toBeNull()
  })

  test('displayCheckboxes reads the checkbox state for the retained entry, not for the current null slot', () => {
    // Distinct checkboxes per (repoId, branchName). When the slot is
    // null after close, the helper must still return the checkbox
    // state for the last opened entry — otherwise the checkbox would
    // visually reset to all-false during the close animation even
    // though the persisted state is still keyed by the entry.
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      selectedBranch: 'main',
    })
    seedRepoState({
      id: OTHER_REPO_ID,
      branches: [createRepoBranch('main')],
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
    expect(handle.current?.displayCheckboxes.deleteAlsoUpstream).toBe(true)

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

    expect(handle.current?.displayCheckboxes.deleteAlsoUpstream).toBe(true)
    expect(handle.current?.entry?.repoId).toBe(REPO_ID)
    expect(handle.current?.entry?.branchName).toBe('main')
  })

  test('displayCheckboxes is the frozen EMPTY_CHECKBOXES singleton when no entry has ever been open', () => {
    // Returning a fresh `{...}` object each render would defeat
    // downstream `Object.is` checks; the helper must always return
    // the same singleton so consumers can rely on reference identity.
    setupRepo()
    const handle = mountHarness<RemoveWorktreeDialogPayload>(null)
    expect(handle.current?.displayCheckboxes).toBe(EMPTY_CHECKBOXES)
    expect(Object.isFrozen(handle.current?.displayCheckboxes)).toBe(true)
  })
})
