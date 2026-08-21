// Centralized state lets confirmation dialogs survive temporary trigger
// surfaces unmounting. Invariants enforced by the store:
//   * At most one dialog is open at a time across the whole app.
//     `openXxx` actions null the other four slots atomically.
//   * Dialog state is keyed by (repoId, branchName) so two rows in
//     the same repo, or two repos' branch lists, can carry their
//     own dialog payload + checkbox state without colliding.
//   * `closeStaleDialogs(currentWorkspaceId, currentBranchName)` is the
//     single cleanup hook used by the Layout-level host to clear
//     any dialog that no longer belongs to the current workspace route.

import { createStore } from 'zustand/vanilla'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RemoveWorktreeDialogPayload {
  branch: string
  path: string
}

type BranchActionDialogKey =
  'pushConfirm' | 'deleteConfirm' | 'forceDeleteConfirm' | 'removeConfirm' | 'forceRemoveConfirm'

export interface BranchActionDialogEntry<P> {
  repoId: WorkspaceId
  branchName: string
  payload: P
}

export interface BranchCheckboxState {
  removeAlsoDeletes: boolean
  removeAlsoUpstream: boolean
  deleteAlsoUpstream: boolean
}

export const EMPTY_CHECKBOXES: Readonly<BranchCheckboxState> = Object.freeze({
  removeAlsoDeletes: false,
  removeAlsoUpstream: false,
  deleteAlsoUpstream: false,
})

export function branchCheckboxKey(repoId: WorkspaceId, branchName: string): string {
  return `${repoId}\0${branchName}`
}

export function branchCheckboxesFor(
  state: BranchActionDialogsState,
  repoId: WorkspaceId,
  branchName: string,
): BranchCheckboxState {
  return state.checkboxStateByBranch[branchCheckboxKey(repoId, branchName)] ?? EMPTY_CHECKBOXES
}

const DIALOG_KEYS: readonly BranchActionDialogKey[] = [
  'pushConfirm',
  'deleteConfirm',
  'forceDeleteConfirm',
  'removeConfirm',
  'forceRemoveConfirm',
]

interface BranchActionDialogsState {
  pushConfirm: BranchActionDialogEntry<string> | null
  deleteConfirm: BranchActionDialogEntry<string> | null
  forceDeleteConfirm: BranchActionDialogEntry<string> | null
  removeConfirm: BranchActionDialogEntry<RemoveWorktreeDialogPayload> | null
  forceRemoveConfirm: BranchActionDialogEntry<RemoveWorktreeDialogPayload> | null
  checkboxStateByBranch: Record<string, BranchCheckboxState>
}

interface BranchActionDialogsActions {
  openPushConfirm: (entry: BranchActionDialogEntry<string>) => void
  openDeleteConfirm: (entry: BranchActionDialogEntry<string>) => void
  openForceDeleteConfirm: (entry: BranchActionDialogEntry<string>) => void
  /**
   * Open the "Remove worktree" confirm. On the first open for a given
   * (repoId, branchName) the checkbox state is initialized from branch
   * context (`isProtectedBranch`); subsequent opens preserve the user's
   * previous choice.
   *
   * Closes any other dialog slot, enforcing the "one dialog open at a
   * time" invariant.
   */
  openRemoveWorktreeConfirm: (
    entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload>,
    options?: { isProtectedBranch?: boolean },
  ) => void
  /**
   * Promote the in-flight "Remove worktree" attempt to a force-delete
   * confirm. Closes the regular confirm so the force confirm is the
   * single visible dialog. Preserves the user's existing checkbox
   * choices, including `deleteAlsoUpstream` set in the regular confirm.
   */
  openForceRemoveWorktreeConfirm: (entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload>) => void
  closeDialog: (key: BranchActionDialogKey) => void
  /**
   * Close any dialog whose (repoId, branchName) does not match
   * `currentWorkspaceId` / `currentBranchName`. Called by the host on
   * workspace change so that a dialog opened in repo A is dismissed
   * when the user switches to repo B, and a dialog opened for a
   * non-current branch in repo A is dismissed when the user changes
   * the current route branch.
   */
  closeStaleDialogs: (currentWorkspaceId: WorkspaceId | null, currentBranchName: string | null) => void
  setRemoveAlsoDeletes: (repoId: WorkspaceId, branchName: string, value: boolean) => void
  setRemoveAlsoUpstream: (repoId: WorkspaceId, branchName: string, value: boolean) => void
  setDeleteAlsoUpstream: (repoId: WorkspaceId, branchName: string, value: boolean) => void
}

type BranchActionDialogsStore = BranchActionDialogsState & BranchActionDialogsActions

function updateCheckbox(
  state: BranchActionDialogsState,
  repoId: WorkspaceId,
  branchName: string,
  patch: Partial<BranchCheckboxState>,
): Pick<BranchActionDialogsState, 'checkboxStateByBranch'> {
  const key = branchCheckboxKey(repoId, branchName)
  const existing = state.checkboxStateByBranch[key] ?? EMPTY_CHECKBOXES
  return {
    checkboxStateByBranch: {
      ...state.checkboxStateByBranch,
      [key]: { ...existing, ...patch },
    },
  }
}

/**
 * Build the "close every other slot" patch. Used by every `openXxx`
 * action to enforce the single-dialog-at-a-time invariant without each
 * call site having to remember to null the others.
 */
function closeOtherSlots(except: BranchActionDialogKey): Partial<BranchActionDialogsState> {
  const next: Partial<Record<BranchActionDialogKey, null>> = {}
  for (const key of DIALOG_KEYS) {
    if (key !== except) {
      next[key] = null
    }
  }
  return next
}

const INITIAL_STATE: BranchActionDialogsState = {
  pushConfirm: null,
  deleteConfirm: null,
  forceDeleteConfirm: null,
  removeConfirm: null,
  forceRemoveConfirm: null,
  checkboxStateByBranch: {},
}

export const branchActionDialogsStore = createStore<BranchActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,

  openPushConfirm: (entry) =>
    set({
      ...closeOtherSlots('pushConfirm'),
      pushConfirm: entry,
    }),

  openDeleteConfirm: (entry) =>
    set((state) => ({
      ...closeOtherSlots('deleteConfirm'),
      deleteConfirm: entry,
      // A new delete request resets this choice; force promotion preserves it.
      checkboxStateByBranch: updateCheckbox(state, entry.repoId, entry.branchName, {
        deleteAlsoUpstream: false,
      }).checkboxStateByBranch,
    })),

  openForceDeleteConfirm: (entry) =>
    set({
      ...closeOtherSlots('forceDeleteConfirm'),
      forceDeleteConfirm: entry,
      // Force promotion preserves choices from the regular confirmation.
    }),

  openRemoveWorktreeConfirm: (entry, options) =>
    set((state) => {
      const key = branchCheckboxKey(entry.repoId, entry.branchName)
      const existing = state.checkboxStateByBranch[key]
      const isProtectedBranch = options?.isProtectedBranch ?? false
      // Seed protected branches with deletion disabled; later opens keep the
      // user's last choice.
      const nextCheckboxes: BranchCheckboxState = existing ?? {
        removeAlsoDeletes: !isProtectedBranch,
        removeAlsoUpstream: false,
        deleteAlsoUpstream: false,
      }
      return {
        ...closeOtherSlots('removeConfirm'),
        removeConfirm: entry,
        checkboxStateByBranch: {
          ...state.checkboxStateByBranch,
          [key]: nextCheckboxes,
        },
      }
    }),

  openForceRemoveWorktreeConfirm: (entry) =>
    set({
      ...closeOtherSlots('forceRemoveConfirm'),
      forceRemoveConfirm: entry,
      // Force promotion shares all choices with the regular confirmation.
    }),

  closeDialog: (key) =>
    set(() => {
      switch (key) {
        case 'pushConfirm':
          return { pushConfirm: null }
        case 'deleteConfirm':
          return { deleteConfirm: null }
        case 'forceDeleteConfirm':
          return { forceDeleteConfirm: null }
        case 'removeConfirm':
          return { removeConfirm: null }
        case 'forceRemoveConfirm':
          return { forceRemoveConfirm: null }
      }
    }),

  closeStaleDialogs: (currentWorkspaceId, currentBranchName) =>
    set((state) => {
      let next: Partial<BranchActionDialogsState> | null = null
      for (const key of DIALOG_KEYS) {
        const slot = state[key]
        if (slot && (slot.repoId !== currentWorkspaceId || slot.branchName !== currentBranchName)) {
          next ??= {}
          next[key] = null
        }
      }
      return next ?? state
    }),

  setRemoveAlsoDeletes: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { removeAlsoDeletes: value })),

  setRemoveAlsoUpstream: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { removeAlsoUpstream: value })),

  setDeleteAlsoUpstream: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { deleteAlsoUpstream: value })),
}))

export function resetBranchActionDialogsStore(): void {
  // setState merges the initial fields while preserving action functions.
  branchActionDialogsStore.setState(() => ({ ...INITIAL_STATE }))
}
