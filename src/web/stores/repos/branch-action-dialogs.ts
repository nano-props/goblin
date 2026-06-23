// Branch action confirmation dialog state. Lifted out of component
// local state so that confirmation dialogs opened from a temporary
// surface (e.g. the focus-mode HoverCard popover) survive the surface
// unmounting. Previously `useRetainedDialogState` was used inside
// `useBranchActions` and the dialog state was destroyed as soon as
// the row that hosted it was unmounted — see the focus-mode
// "Delete worktree does nothing" bug.
//
// Follows docs/arch.md "Keep overlays centralized" — branch action
// dialogs are now owned by a single store instead of one state slot
// per BranchActionsMenu instance.

import { create } from 'zustand'

export interface RemoveWorktreeDialogPayload {
  branch: string
  path: string
}

export type BranchActionDialogKey =
  | 'pushConfirm'
  | 'deleteConfirm'
  | 'forceDeleteConfirm'
  | 'removeConfirm'
  | 'forceRemoveConfirm'

export interface BranchActionDialogEntry<P> {
  repoId: string
  branchName: string
  payload: P
}

export interface BranchCheckboxState {
  removeAlsoDeletes: boolean
  removeAlsoUpstream: boolean
  deleteAlsoUpstream: boolean
}

const EMPTY_CHECKBOXES: BranchCheckboxState = {
  removeAlsoDeletes: false,
  removeAlsoUpstream: false,
  deleteAlsoUpstream: false,
}

export function branchCheckboxKey(repoId: string, branchName: string): string {
  return `${repoId}\0${branchName}`
}

export function branchCheckboxesFor(
  state: BranchActionDialogsState,
  repoId: string,
  branchName: string,
): BranchCheckboxState {
  return state.checkboxStateByBranch[branchCheckboxKey(repoId, branchName)] ?? EMPTY_CHECKBOXES
}

interface BranchActionDialogsState {
  pushConfirm: BranchActionDialogEntry<string> | null
  deleteConfirm: BranchActionDialogEntry<string> | null
  forceDeleteConfirm: BranchActionDialogEntry<string> | null
  removeConfirm: BranchActionDialogEntry<RemoveWorktreeDialogPayload> | null
  forceRemoveConfirm: BranchActionDialogEntry<RemoveWorktreeDialogPayload> | null
  checkboxStateByBranch: Record<string, BranchCheckboxState>
}

export interface BranchActionDialogsActions {
  openPushConfirm: (entry: BranchActionDialogEntry<string>) => void
  openDeleteConfirm: (entry: BranchActionDialogEntry<string>) => void
  openForceDeleteConfirm: (entry: BranchActionDialogEntry<string>) => void
  /**
   * Open the "Delete worktree" confirm. On the very first open for a
   * given (repoId, branchName) the checkbox state is initialized from
   * branch context (`isProtectedBranch`); on subsequent opens the user's
   * previous choice is preserved — matching the prior per-component
   * `useRetainedDialogState` + `useState` semantics.
   */
  openRemoveWorktreeConfirm: (
    entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload>,
    options?: { isProtectedBranch?: boolean },
  ) => void
  /**
   * Promote the in-flight "Delete worktree" attempt to a force-delete
   * confirm. Closes the regular confirm so the force confirm is the
   * single visible dialog.
   */
  openForceRemoveWorktreeConfirm: (
    entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload>,
  ) => void
  closeDialog: (key: BranchActionDialogKey) => void
  closeAllDialogs: () => void
  setRemoveAlsoDeletes: (repoId: string, branchName: string, value: boolean) => void
  setRemoveAlsoUpstream: (repoId: string, branchName: string, value: boolean) => void
  setDeleteAlsoUpstream: (repoId: string, branchName: string, value: boolean) => void
}

export type BranchActionDialogsStore = BranchActionDialogsState & BranchActionDialogsActions

function updateCheckbox(
  state: BranchActionDialogsState,
  repoId: string,
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

const INITIAL_STATE: BranchActionDialogsState = {
  pushConfirm: null,
  deleteConfirm: null,
  forceDeleteConfirm: null,
  removeConfirm: null,
  forceRemoveConfirm: null,
  checkboxStateByBranch: {},
}

export const useBranchActionDialogsStore = create<BranchActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,

  openPushConfirm: (entry) => set({ pushConfirm: entry }),

  openDeleteConfirm: (entry) =>
    set((state) => ({
      deleteConfirm: entry,
      checkboxStateByBranch: {
        ...state.checkboxStateByBranch,
        [branchCheckboxKey(entry.repoId, entry.branchName)]: {
          ...(state.checkboxStateByBranch[branchCheckboxKey(entry.repoId, entry.branchName)] ?? EMPTY_CHECKBOXES),
          deleteAlsoUpstream: false,
        },
      },
    })),

  openForceDeleteConfirm: (entry) =>
    set((state) => ({
      forceDeleteConfirm: entry,
      deleteConfirm: null,
      checkboxStateByBranch: {
        ...state.checkboxStateByBranch,
        [branchCheckboxKey(entry.repoId, entry.branchName)]: {
          ...(state.checkboxStateByBranch[branchCheckboxKey(entry.repoId, entry.branchName)] ?? EMPTY_CHECKBOXES),
          deleteAlsoUpstream: false,
        },
      },
    })),

  openRemoveWorktreeConfirm: (entry, options) =>
    set((state) => {
      const key = branchCheckboxKey(entry.repoId, entry.branchName)
      const existing = state.checkboxStateByBranch[key]
      const isProtectedBranch = options?.isProtectedBranch ?? false
      // First-open for this branch: seed removeAlsoDeletes from branch
      // protection so protected branches always start with the checkbox
      // locked off, exactly as the previous useState-init logic did.
      // Subsequent opens keep the user's last choice.
      const nextCheckboxes: BranchCheckboxState = existing ?? {
        removeAlsoDeletes: !isProtectedBranch,
        removeAlsoUpstream: false,
        deleteAlsoUpstream: false,
      }
      return {
        removeConfirm: entry,
        checkboxStateByBranch: {
          ...state.checkboxStateByBranch,
          [key]: nextCheckboxes,
        },
      }
    }),

  openForceRemoveWorktreeConfirm: (entry) =>
    set((state) => ({
      forceRemoveConfirm: entry,
      removeConfirm: null,
      checkboxStateByBranch: {
        ...state.checkboxStateByBranch,
        [branchCheckboxKey(entry.repoId, entry.branchName)]: {
          ...(state.checkboxStateByBranch[branchCheckboxKey(entry.repoId, entry.branchName)] ?? EMPTY_CHECKBOXES),
          // Keep the user's existing removeAlsoDeletes/removeAlsoUpstream
          // choices; the original useBranchActions used the same single
          // useState for both dialogs.
          deleteAlsoUpstream: false,
        },
      },
    })),

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

  closeAllDialogs: () =>
    set({
      pushConfirm: null,
      deleteConfirm: null,
      forceDeleteConfirm: null,
      removeConfirm: null,
      forceRemoveConfirm: null,
    }),

  setRemoveAlsoDeletes: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { removeAlsoDeletes: value })),

  setRemoveAlsoUpstream: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { removeAlsoUpstream: value })),

  setDeleteAlsoUpstream: (repoId, branchName, value) =>
    set((state) => updateCheckbox(state, repoId, branchName, { deleteAlsoUpstream: value })),
}))

export function resetBranchActionDialogsStore(): void {
  useBranchActionDialogsStore.setState((current) => ({ ...INITIAL_STATE, ...current }) as BranchActionDialogsStore)
}