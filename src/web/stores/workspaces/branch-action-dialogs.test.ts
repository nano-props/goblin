// Store-level unit tests for the branch action dialogs store.
// Coverage here focuses on the persistence-across-unmount invariant
// that the previous per-component design violated.

import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  branchCheckboxKey,
  branchCheckboxesFor,
  resetBranchActionDialogsStore,
  branchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'

const WORKSPACE_1 = workspaceIdForTest('goblin+file:///workspace-1')
const WORKSPACE_A = workspaceIdForTest('goblin+file:///workspace-a')
const WORKSPACE_B = workspaceIdForTest('goblin+file:///workspace-b')
const UNKNOWN_WORKSPACE = workspaceIdForTest('goblin+file:///unknown-workspace')

describe('branchActionDialogsStore', () => {
  beforeEach(() => {
    resetBranchActionDialogsStore()
  })

  test('initial state has all dialog slots closed and no checkbox entries', async () => {
    const state = branchActionDialogsStore.getState()
    expect(state.pushConfirm).toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.forceDeleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm).toBeNull()
    expect(state.checkboxStateByBranch).toEqual({})
  })

  test('openPushConfirm sets the pushConfirm slot', async () => {
    branchActionDialogsStore.getState().openPushConfirm({
      repoId: WORKSPACE_1,
      branchName: 'main',
      payload: 'main',
    })
    expect(branchActionDialogsStore.getState().pushConfirm).toEqual({
      repoId: WORKSPACE_1,
      branchName: 'main',
      payload: 'main',
    })
  })

  test('openRemoveWorktreeConfirm seeds removeAlsoDeletes from isProtectedBranch on first open', async () => {
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    const state = branchActionDialogsStore.getState()
    expect(state.removeConfirm?.payload).toEqual({ branch: 'feature/x', path: '/tmp/x' })
    expect(state.checkboxStateByBranch[branchCheckboxKey(WORKSPACE_1, 'feature/x')]).toEqual({
      removeAlsoDeletes: true,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('openRemoveWorktreeConfirm locks removeAlsoDeletes off when branch is protected', async () => {
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'main',
        payload: { branch: 'main', path: '/tmp/main' },
      },
      { isProtectedBranch: true },
    )
    expect(branchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey(WORKSPACE_1, 'main')]).toEqual({
      removeAlsoDeletes: false,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('openRemoveWorktreeConfirm preserves user choices on subsequent opens', async () => {
    // First open: user toggles removeAlsoDeletes off
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    branchActionDialogsStore.getState().setRemoveAlsoDeletes(WORKSPACE_1, 'feature/x', false)

    // Second open: user choice is kept
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    expect(
      branchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey(WORKSPACE_1, 'feature/x')],
    ).toMatchObject({ removeAlsoDeletes: false })
  })

  test('openForceRemoveWorktreeConfirm closes the regular removeConfirm slot', async () => {
    const payload: RemoveWorktreeDialogPayload = { branch: 'feature/x', path: '/tmp/x' }
    branchActionDialogsStore
      .getState()
      .openRemoveWorktreeConfirm(
        { repoId: WORKSPACE_1, branchName: 'feature/x', payload },
        { isProtectedBranch: false },
      )
    expect(branchActionDialogsStore.getState().removeConfirm).not.toBeNull()

    branchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
      repoId: WORKSPACE_1,
      branchName: 'feature/x',
      payload,
    })
    const state = branchActionDialogsStore.getState()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm?.payload).toEqual(payload)
  })

  test('closeDialog closes a single named slot', async () => {
    branchActionDialogsStore.getState().openPushConfirm({
      repoId: WORKSPACE_1,
      branchName: 'main',
      payload: 'main',
    })
    branchActionDialogsStore.getState().closeDialog('pushConfirm')
    expect(branchActionDialogsStore.getState().pushConfirm).toBeNull()
  })

  test('closeStaleDialogs only closes dialogs whose (repoId, branchName) does not match', async () => {
    // Seed three slots directly via setState to bypass the
    // one-dialog-at-a-time invariant of `openXxx` (which is tested
    // elsewhere). The bug being covered is in the close path, not
    // the open path.
    branchActionDialogsStore.setState({
      pushConfirm: { repoId: WORKSPACE_A, branchName: 'main', payload: 'main' },
      deleteConfirm: { repoId: WORKSPACE_A, branchName: 'feature/x', payload: 'feature/x' },
      removeConfirm: {
        repoId: WORKSPACE_B,
        branchName: 'main',
        payload: { branch: 'main', path: '/b/main' },
      },
    })

    // Active workspace is (repo-a, main). Only the matching
    // pushConfirm should survive; the other two close.
    branchActionDialogsStore.getState().closeStaleDialogs(WORKSPACE_A, 'main')
    const state = branchActionDialogsStore.getState()
    expect(state.pushConfirm).not.toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
  })

  test('closeStaleDialogs closes every dialog when there is no current workspace', async () => {
    branchActionDialogsStore.setState({
      pushConfirm: { repoId: WORKSPACE_A, branchName: 'main', payload: 'main' },
      removeConfirm: {
        repoId: WORKSPACE_B,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/workspace-b/feature-x' },
      },
    })

    branchActionDialogsStore.getState().closeStaleDialogs(null, null)

    const state = branchActionDialogsStore.getState()
    expect(state.pushConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
  })

  test('resetBranchActionDialogsStore actually clears slot state (regression: spread-order bug)', async () => {
    // Pre-fix implementation used `{ ...INITIAL_STATE, ...current }`,
    // which let `current` override every key in `INITIAL_STATE` and
    // was a no-op. The fix uses `{ ...INITIAL_STATE }` so the reset
    // actually reaches the slot fields.
    //
    // We seed the slots directly via `setState` to bypass the
    // one-dialog-at-a-time invariant of `openXxx` (which is tested
    // separately); the bug is in the reset path, not the open path.
    branchActionDialogsStore.setState({
      pushConfirm: { repoId: WORKSPACE_1, branchName: 'main', payload: 'main' },
      deleteConfirm: { repoId: WORKSPACE_1, branchName: 'main', payload: 'main' },
      forceDeleteConfirm: { repoId: WORKSPACE_1, branchName: 'main', payload: 'main' },
      removeConfirm: {
        repoId: WORKSPACE_1,
        branchName: 'main',
        payload: { branch: 'main', path: '/p' },
      },
      forceRemoveConfirm: {
        repoId: WORKSPACE_1,
        branchName: 'main',
        payload: { branch: 'main', path: '/p' },
      },
      checkboxStateByBranch: {
        [branchCheckboxKey(WORKSPACE_1, 'main')]: {
          removeAlsoDeletes: true,
          removeAlsoUpstream: false,
          deleteAlsoUpstream: true,
        },
      },
    })

    resetBranchActionDialogsStore()
    const state = branchActionDialogsStore.getState()
    expect(state.pushConfirm).toBeNull()
    expect(state.deleteConfirm).toBeNull()
    expect(state.forceDeleteConfirm).toBeNull()
    expect(state.removeConfirm).toBeNull()
    expect(state.forceRemoveConfirm).toBeNull()
    expect(state.checkboxStateByBranch).toEqual({})
  })

  test('checkbox state survives across dialog close/reopen of the same branch', async () => {
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    branchActionDialogsStore.getState().setRemoveAlsoUpstream(WORKSPACE_1, 'feature/x', true)
    branchActionDialogsStore.getState().closeDialog('removeConfirm')
    // Reopen — keep user's toggle.
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(
      {
        repoId: WORKSPACE_1,
        branchName: 'feature/x',
        payload: { branch: 'feature/x', path: '/tmp/x' },
      },
      { isProtectedBranch: false },
    )
    expect(
      branchActionDialogsStore.getState().checkboxStateByBranch[branchCheckboxKey(WORKSPACE_1, 'feature/x')],
    ).toMatchObject({ removeAlsoUpstream: true })
  })

  test('checkbox state is independent per branch', async () => {
    branchActionDialogsStore
      .getState()
      .openRemoveWorktreeConfirm(
        { repoId: WORKSPACE_1, branchName: 'feature/a', payload: { branch: 'feature/a', path: '/a' } },
        { isProtectedBranch: false },
      )
    branchActionDialogsStore
      .getState()
      .openRemoveWorktreeConfirm(
        { repoId: WORKSPACE_1, branchName: 'feature/b', payload: { branch: 'feature/b', path: '/b' } },
        { isProtectedBranch: false },
      )
    branchActionDialogsStore.getState().setRemoveAlsoUpstream(WORKSPACE_1, 'feature/a', true)

    expect(branchCheckboxesFor(branchActionDialogsStore.getState(), WORKSPACE_1, 'feature/a')).toMatchObject({
      removeAlsoUpstream: true,
    })
    expect(branchCheckboxesFor(branchActionDialogsStore.getState(), WORKSPACE_1, 'feature/b')).toMatchObject({
      removeAlsoUpstream: false,
    })
  })

  test('branchCheckboxesFor returns default checkboxes for unknown branches', async () => {
    expect(branchCheckboxesFor(branchActionDialogsStore.getState(), UNKNOWN_WORKSPACE, 'branch')).toEqual({
      removeAlsoDeletes: false,
      removeAlsoUpstream: false,
      deleteAlsoUpstream: false,
    })
  })

  test('regression: dialog state survives any component lifecycle — store is the only owner', async () => {
    // This test encodes the invariant the zen-mode bug violated.
    // Before this refactor, dialog state lived in `useRetainedDialogState`
    // inside `useBranchActions`, which was itself called from inside
    // a HoverCard subtree. When the HoverCard unmounted, the dialog
    // state was destroyed. The fix moves state out of any component
    // subtree, so this test simply verifies the store keeps the slot
    // open regardless of any "component" events.
    const payload: RemoveWorktreeDialogPayload = { branch: 'feature/x', path: '/tmp/x' }
    const entry = {
      repoId: WORKSPACE_1,
      branchName: 'feature/x',
      payload,
    }
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: false })
    expect(branchActionDialogsStore.getState().removeConfirm).toEqual(entry)

    // Simulate every conceivable "component unmount" event by simply
    // not touching the store. The slot must remain open.
    expect(branchActionDialogsStore.getState().removeConfirm).toEqual(entry)
    expect(branchActionDialogsStore.getState().removeConfirm?.payload.path).toBe('/tmp/x')
  })
})
