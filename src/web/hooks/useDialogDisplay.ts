// Display-layer retention for a single branch-action dialog slot.
//
// `useBranchActionDialogsStore` clears its slots on close (`closeDialog`,
// `closeStaleDialogs`) so the store never carries stale payloads — that
// is the right model for the data layer. But the dialog needs to keep
// rendering its inner content (title, body, checkboxes) while Radix
// AlertDialog plays its close animation; otherwise the content collapses
// to empty for the duration of the fade-out and the dialog visibly
// snaps in height.
//
// Pre-PR this was handled by `useRetainedDialogState` keeping the
// payload across close. The new store model moves that concern out of
// the data layer and into this hook, applied uniformly at the host
// boundary: every body-visible field — title, body content, checkbox
// state, the resolved `(repo, branch)` context — is derived from the
// retained entry returned here. The `open` prop on `<AlertDialog>` is
// the only thing that should still read the raw slot, because Radix's
// animation state machine needs to see the slot actually become null
// in order to start the close transition.
//
// Keeping the retention in one helper (rather than sprinkled across
// the host's render) means there is exactly one place that defines the
// "what does the user currently see during the close animation"
// invariant, and any future dialog slot added to the host inherits it
// for free.

import {
  branchCheckboxesFor,
  type BranchActionDialogEntry,
  type BranchCheckboxState,
  useBranchActionDialogsStore,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'

export interface BranchActionDialogDisplayContext {
  repo: RepoState
  branch: RepoBranchState
}

export interface BranchActionDialogDisplay<P> {
  /**
   * The live `(repo, branch)` resolved against the raw slot. Used only
   * by the host to drive the `open` prop on `<AlertDialog>` — Radix's
   * animation needs the live slot, not the retained display entry, so
   * it can transition `true → false` when the user clicks Cancel/Confirm.
   * `null` when the slot is null or the entry's branch has been deleted
   * from the repo (in which case the dialog should close too).
   */
  liveCtx: BranchActionDialogDisplayContext | null
  /**
   * The retained entry. Equal to the live slot while the dialog is
   * open; falls back to the last non-null slot seen during this
   * component's lifetime once the slot has been cleared by
   * `closeDialog`. `null` only if no entry has ever been open.
   */
  display: BranchActionDialogEntry<P> | null
  /**
   * The `(repo, branch)` resolved from the display entry. `null` when
   * `display` is null, or when the entry's branch is no longer present
   * in `useReposStore` (e.g. deleted upstream while the dialog is open).
   */
  displayCtx: BranchActionDialogDisplayContext | null
  /**
   * The persisted checkbox state for the entry's `(repoId, branchName)`.
   * Also retained across close so the user's last choice stays rendered
   * during the close animation.
   */
  displayCheckbox: BranchCheckboxState
}

/**
 * Display data for one dialog slot, retained across close.
 *
 * Pass the raw slot (subscribed from `useBranchActionDialogsStore`),
 * and read everything the host needs from the returned view:
 *   - `liveCtx` → `open` prop on `<AlertDialog>`.
 *   - `display`, `displayCtx`, `displayCheckbox` → the dialog's title,
 *     message, body, and checkbox state.
 */
export function useDialogDisplay<P>(slot: BranchActionDialogEntry<P> | null): BranchActionDialogDisplay<P> {
  const display = useLastNonNull(slot)
  const repos = useReposStore((s) => s.repos)

  // Live context for the `open` prop. Resolves against the raw slot;
  // null when the slot is null or its branch has been removed from
  // the repo.
  const liveCtx = slot ? resolveContext(repos, slot) : null

  // Retained context for the body. Resolves against the retained
  // entry, not the raw slot — this is what keeps the body rendering
  // during the close animation. The slot may be null but the dialog
  // should still show the last opened branch's data.
  const displayCtx = display ? resolveContext(repos, display) : null

  // The checkbox state is keyed by `(repoId, branchName)` and survives
  // close (the user's choice is preserved across the regular ↔ force
  // confirm transition). Subscribing via the *retained* entry keeps
  // the checkbox at its last value during the close animation; if we
  // closed over `slot` instead, the checkbox would visually uncheck
  // the moment `closeDialog` nulls the slot.
  const displayCheckbox = useBranchActionDialogsStore((s) =>
    display ? branchCheckboxesFor(s, display.repoId, display.branchName) : EMPTY_CHECKBOXES,
  )

  return { liveCtx, display, displayCtx, displayCheckbox }
}

const EMPTY_CHECKBOXES: BranchCheckboxState = {
  removeAlsoDeletes: false,
  removeAlsoUpstream: false,
  deleteAlsoUpstream: false,
}

function resolveContext<P>(
  repos: Record<string, RepoState>,
  entry: BranchActionDialogEntry<P>,
): BranchActionDialogDisplayContext | null {
  const repo = repos[entry.repoId]
  if (!repo) return null
  const branch = repo.data.branches.find((b) => b.name === entry.branchName)
  if (!branch) return null
  return { repo, branch }
}