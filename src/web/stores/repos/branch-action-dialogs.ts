// Branch action confirmation dialog state. Lifted out of component
// local state so that a confirmation requested from a temporary
// surface (e.g. the zen-mode HoverCard popover) survives the
// surface unmounting. Previously `useRetainedDialogState` was used
// inside `useBranchActions` and the dialog state was destroyed as
// soon as the row that hosted it was unmounted — see the zen-mode
// "Delete worktree does nothing" bug.
//
// Follows docs/arch.md "Keep overlays centralized" — branch action
// dialogs are now owned by a single store instead of one state slot
// per BranchActionsMenu instance.
//
// Invariants enforced by the store:
//   * At most one dialog is open at a time across the whole app.
//     `openXxx` actions null the other four slots atomically.
//   * Dialog state is keyed by (repoId, branchName) so two rows in
//     the same repo, or two repos' branch lists, can carry their
//     own dialog payload + checkbox state without colliding.
//   * `closeStaleDialogs(currentRepoId, currentBranchName)` is the
//     single cleanup hook used by the Layout-level host to clear
//     any dialog that no longer belongs to the current workspace route.

import { create } from 'zustand'

export interface RemoveWorktreeDialogPayload {
  branch: string
  path: string
}

type BranchActionDialogKey =
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

export const EMPTY_CHECKBOXES: Readonly<BranchCheckboxState> = Object.freeze({
  removeAlsoDeletes: false,
  removeAlsoUpstream: false,
  deleteAlsoUpstream: false,
})

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
   * previous choice — matching the prior per-component
   * `useRetainedDialogState` + `useState` semantics.
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
   * choices (including `deleteAlsoUpstream` set in the regular
   * confirm) — only the previous code reset `deleteAlsoUpstream: false`
   * here, which was a regression from pre-PR behaviour.
   */
  openForceRemoveWorktreeConfirm: (entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload>) => void
  closeDialog: (key: BranchActionDialogKey) => void
  /**
   * Close any dialog whose (repoId, branchName) does not match
   * `currentRepoId` / `currentBranchName`. Called by the host on
   * workspace change so that a dialog opened in repo A is dismissed
   * when the user switches to repo B, and a dialog opened for a
   * non-current branch in repo A is dismissed when the user changes
   * the current route branch.
   */
  closeStaleDialogs: (currentRepoId: string, currentBranchName: string) => void
  setRemoveAlsoDeletes: (repoId: string, branchName: string, value: boolean) => void
  setRemoveAlsoUpstream: (repoId: string, branchName: string, value: boolean) => void
  setDeleteAlsoUpstream: (repoId: string, branchName: string, value: boolean) => void
}

type BranchActionDialogsStore = BranchActionDialogsState & BranchActionDialogsActions

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

/**
 * Build the "close every other slot" patch. Used by every `openXxx`
 * action to enforce the single-dialog-at-a-time invariant without each
 * call site having to remember to null the others.
 */
function closeOtherSlots(
  state: BranchActionDialogsState,
  except: BranchActionDialogKey,
): Partial<BranchActionDialogsState> {
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

export const useBranchActionDialogsStore = create<BranchActionDialogsStore>()((set) => ({
  ...INITIAL_STATE,

  openPushConfirm: (entry) =>
    set((state) => ({
      ...closeOtherSlots(state, 'pushConfirm'),
      pushConfirm: entry,
    })),

  openDeleteConfirm: (entry) =>
    set((state) => ({
      ...closeOtherSlots(state, 'deleteConfirm'),
      deleteConfirm: entry,
      // Reset the upstream-delete checkbox on each new entry-point
      // open. Pre-PR behaviour: `setDeleteAlsoUpstream(false)` at the
      // request layer in useBranchActions. Force-promote paths
      // deliberately do NOT reset this — see the comment on
      // openForceDeleteConfirm below.
      checkboxStateByBranch: updateCheckbox(state, entry.repoId, entry.branchName, {
        deleteAlsoUpstream: false,
      }).checkboxStateByBranch,
    })),

  openForceDeleteConfirm: (entry) =>
    set((state) => ({
      ...closeOtherSlots(state, 'forceDeleteConfirm'),
      forceDeleteConfirm: entry,
      // Preserve all of the user's existing checkbox choices from
      // the regular `deleteConfirm` — including `deleteAlsoUpstream`.
      // The pre-PR code (useRetainedDialogState + useState) had the
      // same semantics: checkbox state was shared across the regular
      // and force confirm dialogs, with only `requestDeleteBranch`
      // resetting it on entry.
    })),

  openRemoveWorktreeConfirm: (entry, options) =>
    set((state) => {
      const key = branchCheckboxKey(entry.repoId, entry.branchName)
      const existing = state.checkboxStateByBranch[key]
      const isProtectedBranch = options?.isProtectedBranch ?? false
      // First-open for this branch: seed removeAlsoDeletes from
      // branch protection so protected branches always start with
      // the checkbox locked off, matching the previous useState-init
      // logic. Subsequent opens keep the user's last choice.
      const nextCheckboxes: BranchCheckboxState = existing ?? {
        removeAlsoDeletes: !isProtectedBranch,
        removeAlsoUpstream: false,
        deleteAlsoUpstream: false,
      }
      return {
        ...closeOtherSlots(state, 'removeConfirm'),
        removeConfirm: entry,
        checkboxStateByBranch: {
          ...state.checkboxStateByBranch,
          [key]: nextCheckboxes,
        },
      }
    }),

  openForceRemoveWorktreeConfirm: (entry) =>
    set((state) => ({
      ...closeOtherSlots(state, 'forceRemoveConfirm'),
      forceRemoveConfirm: entry,
      // No checkbox state reset: removeAlsoDeletes / removeAlsoUpstream
      // are shared with the regular `removeConfirm` (single useState in
      // pre-PR code), and `deleteAlsoUpstream` was deliberately not
      // reset by pre-PR's `forceRemoveConfirm.openWith(target)` either.
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

  closeStaleDialogs: (currentRepoId, currentBranchName) =>
    set((state) => {
      let next: Partial<BranchActionDialogsState> | null = null
      for (const key of DIALOG_KEYS) {
        const slot = state[key]
        if (slot && (slot.repoId !== currentRepoId || slot.branchName !== currentBranchName)) {
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
  // Replace the state with INITIAL_STATE while preserving the action
  // function references (which are set once at store creation).
  // The previous implementation spread `...INITIAL_STATE` first and
  // `...current` last, which meant every key in INITIAL_STATE was
  // shadowed by `current`'s value — a no-op.
  useBranchActionDialogsStore.setState(() => ({ ...INITIAL_STATE }))
}
