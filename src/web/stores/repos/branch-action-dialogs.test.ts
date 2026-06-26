// Store-level unit tests for the branch action dialogs store.
// Coverage here focuses on the persistence-across-unmount invariant
// that the previous per-component design violated.

import { beforeEach, describe, expect, test } from 'vitest'
import {
  branchCheckboxKey,
  branchCheckboxesFor,
  resetBranchActionDialogsStore,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'

describe('useBranchActionDialogsStore', () => {
  beforeEach(() => {
    resetBranchActionDialogsStore()
  })

  test('initial state has all dialog slots closed and no checkbox entries', () => {
    const state = useBranchActionDialogsStore.getState()
    expect(state.pushConfirm).toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.forceDeleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm).toBeNull()
    expect(state.checkboxStateByBranch).toEqual({})
  })

  test('openPushConfirm sets the pushConfirm slot', () => {
    useBranchActionDialogsStore.getState().openPushConfirm({
      repoId: 'repo-1',
      branchName: 'main',
      payload: 'main',
    })
    expect(useBranchActionDialogsStore.getState().pushConfirm).toEqual({
      repoId: 'repo-1',
      branchName: 'main',
      payload: 'main',
    })
  })

  test('openRemoveWorktreeConfirm seeds removeAlsoDeletes from isProtectedBranch on first open', () => {
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    const state = useBranchActionDialogsStore.getState()
    expect(state.removeConfirm?.payload).toEqual({ branch: 'feature/x', path: '/tmp/x' })
    expect(state.checkboxStateByBranch[branchCheckboxKey('repo-1', 'feature/x')]).toEqual({
      removeAlsoDeletes: true,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('openRemoveWorktreeConfirm locks removeAlsoDeletes off when branch is protected', () => {
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'main',
        payload: { branch: 'main', path: '/tmp/main' },
      },
      { isProtectedBranch: true },
    )
    expect(
      useBranchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey('repo-1', 'main')],
    ).toEqual({
      removeAlsoDeletes: false,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('openRemoveWorktreeConfirm preserves user choices on subsequent opens', () => {
    // First open: user toggles removeAlsoDeletes off
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    useBranchActionDialogsStore.getState().setRemoveAlsoDeletes('repo-1', 'feature/x', false)

    // Second open: user choice is kept
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    expect(
      useBranchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey('repo-1', 'feature/x')],
    ).toMatchObject({ removeAlsoDeletes: false })
  })

  test('openForceRemoveWorktreeConfirm closes the regular removeConfirm slot', () => {
    const payload: RemoveWorktreeDialogPayload = { branch: 'feature/x', path: '/tmp/x' }
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      { repoId: 'repo-1', branchName: 'feature/x', payload },
      { isProtectedBranch: false },
    )
    expect(useBranchActionDialogsStore.getState().removeConfirm).not.toBeNull()

    useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
      repoId: 'repo-1',
      branchName: 'feature/x',
      payload,
    })
    const state = useBranchActionDialogsStore.getState()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm?.payload).toEqual(payload)
  })

  test('closeDialog closes a single named slot', () => {
    useBranchActionDialogsStore.getState().openPushConfirm({
      repoId: 'repo-1',
      branchName: 'main',
      payload: 'main',
    })
    useBranchActionDialogsStore.getState().closeDialog('pushConfirm')
    expect(useBranchActionDialogsStore.getState().pushConfirm).toBeNull()
  })

  test('closeStaleDialogs only closes dialogs whose (repoId, branchName) does not match', () => {
    // Seed three slots directly via setState to bypass the
    // one-dialog-at-a-time invariant of `openXxx` (which is tested
    // elsewhere). The bug being covered is in the close path, not
    // the open path.
    useBranchActionDialogsStore.setState({
      pushConfirm: { repoId: 'repo-a', branchName: 'main', payload: 'main' },
      deleteConfirm: { repoId: 'repo-a', branchName: 'feature/x', payload: 'feature/x' },
      removeConfirm: {
        repoId: 'repo-b',
        branchName: 'main',
        payload: { branch: 'main', path: '/b/main' },
      },
    })

    // Active workspace is (repo-a, main). Only the matching
    // pushConfirm should survive; the other two close.
    useBranchActionDialogsStore.getState().closeStaleDialogs('repo-a', 'main')
    const state = useBranchActionDialogsStore.getState()
    expect(state.pushConfirm).not.toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
  })

  test('resetBranchActionDialogsStore actually clears slot state (regression: spread-order bug)', () => {
    // Pre-fix implementation used `{ ...INITIAL_STATE, ...current }`,
    // which let `current` override every key in `INITIAL_STATE` and
    // was a no-op. The fix uses `{ ...INITIAL_STATE }` so the reset
    // actually reaches the slot fields.
    //
    // We seed the slots directly via `setState` to bypass the
    // one-dialog-at-a-time invariant of `openXxx` (which is tested
    // separately); the bug is in the reset path, not the open path.
    useBranchActionDialogsStore.setState({
      pushConfirm: { repoId: 'repo-1', branchName: 'main', payload: 'main' },
      deleteConfirm: { repoId: 'repo-1', branchName: 'main', payload: 'main' },
      forceDeleteConfirm: { repoId: 'repo-1', branchName: 'main', payload: 'main' },
      removeConfirm: {
        repoId: 'repo-1',
        branchName: 'main',
        payload: { branch: 'main', path: '/p' },
      },
      forceRemoveConfirm: {
        repoId: 'repo-1',
        branchName: 'main',
        payload: { branch: 'main', path: '/p' },
      },
      checkboxStateByBranch: {
        'repo-1\0main': {
          removeAlsoDeletes: true,
          removeAlsoUpstream: false,
          deleteAlsoUpstream: true,
        },
      },
    })

    resetBranchActionDialogsStore()
    const state = useBranchActionDialogsStore.getState()
    expect(state.pushConfirm).toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.forceDeleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm).toBeNull()
    expect(state.checkboxStateByBranch).toEqual({})
  })

  test('checkbox state survives across dialog close/reopen of the same branch', () => {
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    useBranchActionDialogsStore.getState().setRemoveAlsoUpstream('repo-1', 'feature/x', true)
    useBranchActionDialogsStore.getState().closeDialog('removeConfirm')
    // Reopen — keep user's toggle.
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: 'repo-1',
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    expect(
      useBranchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey('repo-1', 'feature/x')],
    ).toMatchObject({ removeAlsoUpstream: true })
  })

  test('checkbox state is independent per branch', () => {
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      { repoId: 'repo-1', branchName: 'feature/a', payload: { branch: 'feature/a', path: '/a' } },
      { isProtectedBranch: false },
    )
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      { repoId: 'repo-1', branchName: 'feature/b', payload: { branch: 'feature/b', path: '/b' } },
      { isProtectedBranch: false },
    )
    useBranchActionDialogsStore.getState().setRemoveAlsoUpstream('repo-1', 'feature/a', true)

    expect(branchCheckboxesFor(useBranchActionDialogsStore.getState(), 'repo-1', 'feature/a')).toMatchObject({
      removeAlsoUpstream: true,
    })
    expect(branchCheckboxesFor(useBranchActionDialogsStore.getState(), 'repo-1', 'feature/b')).toMatchObject({
      removeAlsoUpstream: false,
    })
  })

  test('branchCheckboxesFor returns default checkboxes for unknown branches', () => {
    expect(branchCheckboxesFor(useBranchActionDialogsStore.getState(), 'unknown', 'branch')).toEqual({
      removeAlsoDeletes: false,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('regression: dialog state survives any component lifecycle — store is the only owner', () => {
    // This test encodes the invariant the zen-mode bug violated.
    // Before this refactor, dialog state lived in `useRetainedDialogState`
    // inside `useBranchActions`, which was itself called from inside
    // a HoverCard subtree. When the HoverCard unmounted, the dialog
    // state was destroyed. The fix moves state out of any React
    // subtree, so this test simply verifies the store keeps the slot
    // open regardless of any "component" events.
    const entry = {
      repoId: 'repo-1',
      branchName: 'feature/x',
      payload: { branch: 'feature/x', path: '/tmp/x' } as RemoveWorktreeDialogPayload,
    }
    useBranchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: false })
    expect(useBranchActionDialogsStore.getState().removeConfirm).toEqual(entry)

    // Simulate every conceivable "component unmount" event by simply
    // not touching the store. The slot must remain open.
    expect(useBranchActionDialogsStore.getState().removeConfirm).toEqual(entry)
    expect(useBranchActionDialogsStore.getState().removeConfirm?.payload.path).toBe('/tmp/x')
  })
})