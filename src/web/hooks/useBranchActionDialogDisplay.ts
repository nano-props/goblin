// Display view for one slot in `useBranchActionDialogsStore`. Bundles
// the three reads the host's body JSX needs into a single object:
//
//   - `entry`: the slot retained across close (via `useLastNonNull`).
//     Drives the body's title, message, and checkbox identity.
//   - `liveContext`: the `(repo, branch)` resolved against the live
//     slot. Drives the `open` prop on `<AlertDialog>` — Radix's
//     animation state machine needs the live slot, not the retained
//     entry, so it can transition `true → false` when the user
//     clicks Cancel/Confirm.
//   - `displayContext`: the `(repo, branch)` resolved against the
//     retained entry. Drives the body's `hasUpstream` / `tracking`.
//   - `displayCheckboxes`: the persisted checkbox state for the
//     entry's `(repoId, branchName)`, also retained across close so
//     the user's last choice stays rendered during the close
//     animation.
//
// Why this hook exists:
//
// The store clears its slots on close (`closeDialog`,
// `closeStaleDialogs`) so the data layer never carries stale
// payloads — that is the right model. But Radix AlertDialog needs the
// inner content (title, body, checkboxes) to keep rendering for the
// duration of the close animation; otherwise the content collapses to
// empty for the fade-out window and the dialog visibly snaps in
// height. Pre-PR this was handled by `useRetainedDialogState` keeping
// the payload across close in component state. The new store model
// pushes that concern out of the data layer and into this hook,
// applied uniformly at the host boundary.
//
// Keeping the retention in one helper (rather than sprinkled across
// the host's render) means every body-visible field is derived from
// the same source, and any future dialog slot added to the host
// inherits the contract for free.
//
// Why `workspaces` is a parameter, not a subscription:
//
// The host calls this hook five times (one per dialog slot). If each
// call subscribed to `useWorkspacesStore((s) => s.workspaces)`, that would be
// five independent listeners plus five selector evaluations per
// store update. The host hoists the subscription and passes the map
// in — one listener, five consumers.
//
// Trade-off — `displayContext` and live-context drift:
//
// The slot is cleared on close (`closeDialog`, `closeStaleDialogs`)
// so the data layer never carries stale payloads — that is the
// right model. But Radix AlertDialog needs the inner content (title,
// body, checkboxes) to keep rendering for the duration of the close
// animation; otherwise the dialog visibly snaps in height for the
// fade-out window. This hook retains both `entry` (the slot payload)
// and the last non-null `liveContext` for the close-animation
// window, so the host can render a fully stable view of the dialog
// until Radix finishes its exit transition.
//
// What if the IPC completes within the close-animation window and
// removes the branch from `useWorkspacesStore`? The retained context
// snapshot is from before the removal, so the body shows a
// `hasUpstream` / `tracking` value that is now stale. We accept
// this: the alternative — collapsing the body to empty mid-fade —
// produced a "title stays, body vanishes" jank that visually
// contradicts the static title. The stale-data window is at most
// ~200 ms (Radix's exit transition) and the user has already
// confirmed the action, so the body is informational at that point.
// The data layer is never lied to — the IPC has already committed,
// and the store has the post-mutation state.

import {
  EMPTY_CHECKBOXES,
  branchCheckboxesFor,
  type BranchActionDialogEntry,
  type BranchCheckboxState,
  useBranchActionDialogsStore,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type { RepoBranchState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { projectBranchActionOperation, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { useRepoBranchReadModel, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { useRepoOperationsReadModel } from '#/web/repo-data-query.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

type BranchActionDialogRepo = Omit<BranchActionRepo, 'branchModel'> & {
  branchModel: RepoBranchReadModelData
}

interface BranchActionDialogContext {
  repo: BranchActionDialogRepo
  branch: RepoBranchState
}

export interface BranchActionDialogDisplay<P> {
  /**
   * The retained slot entry. Equal to `slot` while the dialog is
   * open; falls back to the last non-null `slot` seen during this
   * component's lifetime once the slot has been cleared by
   * `closeDialog`. `null` only if no entry has ever been open.
   */
  entry: BranchActionDialogEntry<P> | null
  /**
   * The `(repo, branch)` resolved from the live slot. `null` when the
   * slot is null or its branch is no longer present in `workspaces` (e.g.
   * deleted upstream). Drives the `open` prop on `<AlertDialog>`.
   */
  liveContext: BranchActionDialogContext | null
  /**
   * The `(repo, branch)` resolved from the retained entry. `null`
   * when `entry` is null, or when the entry's branch is no longer
   * present in `workspaces`. Drives the body's `hasUpstream` / `tracking`
   * reads.
   */
  displayContext: BranchActionDialogContext | null
  /**
   * Persisted checkbox state for the entry's `(repoId, branchName)`.
   * Retained across close so the user's last choice stays rendered
   * during the close animation.
   */
  displayCheckboxes: Readonly<BranchCheckboxState>
}

export function useBranchActionDialogDisplay<P>(
  slot: BranchActionDialogEntry<P> | null,
  workspaces: Record<string, WorkspaceState>,
): BranchActionDialogDisplay<P> {
  const entry = useLastNonNull(slot)
  const slotRepo = slot ? workspaces[slot.repoId] : null
  const branchReadModel = useRepoBranchReadModel(slot?.repoId ?? null, slotRepo?.workspaceRuntimeId ?? '', !!slotRepo)
  const operationsReadModel = useRepoOperationsReadModel(slot?.repoId ?? null, slotRepo?.workspaceRuntimeId ?? '', {
    enabled: slotRepo?.capability.kind === 'git',
  })
  const liveContext = slot
    ? resolveContext(workspaces, slot, branchReadModel, operationsReadModel.data?.operations)
    : null
  // Retain the last non-null `liveContext` for the close-animation
  // window. After the user clicks Confirm/Cancel, `slot` is null and
  // `liveContext` is null, but the host still needs a stable context
  // to render the body for the duration of Radix's exit transition.
  // Without this, the body would collapse to `''` mid-fade whenever
  // the backend IPC completed within the close-animation window and
  // removed the branch from `workspaces` — visually contradicting the
  // static title that the host now keeps visible.
  const retainedLiveContext = useLastNonNull(liveContext)
  // While the dialog is open, `slot === entry` and the two contexts
  // are the same object lookup. Sharing the result saves one
  // `repo.branchModel.branches.find(...)` per render per slot. After close
  // `slot === null` and `entry` is the retained value — we use the
  // retained `liveContext` (which was resolved from `entry` before
  // close) instead of re-resolving against the post-mutation `workspaces`.
  const displayContext = entry ? (entry === slot ? liveContext : retainedLiveContext) : null
  const displayCheckboxes = useBranchActionDialogsStore((s) =>
    entry ? branchCheckboxesFor(s, entry.repoId, entry.branchName) : EMPTY_CHECKBOXES,
  )
  return { entry, liveContext, displayContext, displayCheckboxes }
}

function resolveContext<P>(
  workspaces: Record<string, WorkspaceState>,
  entry: BranchActionDialogEntry<P>,
  branchReadModel: RepoBranchReadModelData | null,
  operations: readonly RepoServerOperationState[] | undefined,
): BranchActionDialogContext | null {
  const repoFromStore = workspaces[entry.repoId]
  if (!repoFromStore || repoFromStore.capability.kind !== 'git' || !branchReadModel) return null
  const git = repoFromStore.capability.git
  const repo: BranchActionDialogRepo = {
    id: repoFromStore.id,
    workspaceRuntimeId: repoFromStore.workspaceRuntimeId,
    branchModel: branchReadModel,
    branchAction: projectBranchActionOperation(git.operations.branchAction, operations, entry.branchName),
    remote: {
      hasRemotes: git.remote.hasRemotes,
      hasBrowserRemote: git.remote.hasBrowserRemote,
      hasGitHubRemote: git.remote.hasGitHubRemote,
      browserRemoteProvider: git.remote.browserRemoteProvider,
      remoteProviders: git.remote.remoteProviders,
    },
    remoteLifecycle: repoFromStore.admission.kind === 'remote' ? repoFromStore.admission.lifecycle : null,
  }
  const branch = repo.branchModel.branches.find((b) => b.name === entry.branchName)
  if (!branch) return null
  return { repo, branch }
}
