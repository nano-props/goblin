// Multi-repo state. Each opened directory is a Repo identified by its
// absolute path (the toplevel returned by `git rev-parse --show-toplevel`,
// so opening a subdirectory dedupes against an already-open root).
//
// `order` controls left sidebar tab order; `activeId` is the visible
// repo on the right. Per-repo data (branches, log, status, worktrees,
// commit detail) lives inside `repos[id]` so each tab keeps its own
// scroll/selection state when the user flips between them.
//
// Race-condition defenses
//   - `instanceToken`: every time a repo is created/reset we mint a new
//     token. Async writers capture the token at call time and bail when
//     they observe a different token in `set()` — this guards against
//     a stale snapshot from before close-and-reopen overwriting fresh
//     data, and against late commit-detail / log responses landing in
//     the wrong repo.
//   - selection guards: `refreshLog` captures the branch at call time
//     and discards if the user moved on; same idea for `openCommit`.
//   - `inFlightFetchById`: `backgroundFetch` won't double-fire for the
//     same repo, no matter how often `App.tsx`'s effect re-runs.

import { create } from 'zustand'
import { createCommitActions } from '#/renderer/stores/repos/commit.ts'
import { createLifecycleActions } from '#/renderer/stores/repos/lifecycle.ts'
import { createRefreshActions } from '#/renderer/stores/repos/refresh.ts'
import { createSelectionActions } from '#/renderer/stores/repos/selection.ts'
import type { ReposStore } from '#/renderer/stores/repos/types.ts'

export const useReposStore = create<ReposStore>((set, get) => ({
  repos: {},
  order: [],
  activeId: null,
  sessionReady: false,
  missingFromSession: [],

  ...createLifecycleActions(set, get),
  ...createSelectionActions(set, get),
  ...createRefreshActions(set, get),
  ...createCommitActions(set, get),
}))
