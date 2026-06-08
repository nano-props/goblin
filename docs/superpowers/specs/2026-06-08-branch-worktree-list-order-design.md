# Branch Worktree List Order Design

## Goal

The branch/worktree list should make each linked worktree easier to identify and prioritize. Users should see the worktree directory in the branch list and should be able to reorder linked worktrees by dragging them up and down in the Worktrees filter view.

## Scope

In scope:

- Show each linked worktree directory on branch rows in both All and Worktrees views.
- Do not show a placeholder directory line for branches without linked worktrees.
- Enable drag ordering only in the Worktrees filter view.
- Disable drag ordering while a branch search query is active.
- Persist the custom order as per-repository UI cache state.
- Apply the custom worktree order to All view by showing ordered worktree branches first, followed by non-worktree branches in the existing branch order.
- Use the worktree directory path as the persisted ordering identity.

Out of scope:

- Any Git mutation, including branch reorder, checkout, worktree path changes, or branch rename.
- Cross-repository dragging.
- Drag ordering in search results.
- Long-term global user settings for worktree order outside the existing repository cache.
- Reworking detached worktree presentation.

## Current State

`BranchList` renders the visible branch rows from `visibleBranches()`. The helper currently filters by `BranchViewMode` and search query but does not apply a custom order. Worktree state is branch-linked through `branch.worktree.path`; metadata such as dirty, locked, and main worktree state is normalized into `repo.data.worktreesByPath`.

Repository UI state already persists selected branch, branch view mode, and detail tab through `repoCache`. This is the right boundary for a display-only worktree order because it is per repository, already renderer-owned, and can be lost when the repository cache expires or is evicted.

The top repository tab strip already uses dnd-kit for drag ordering. This feature should reuse the same drag semantics, but it should not reuse repository tab state because branch worktree ordering is independent of open repository tab ordering.

## Interaction Semantics

The Worktrees filter view is the only drag entry point. When the branch search query is empty, rows with `branch.worktree.path` show a drag handle and can be moved up or down. When search is active, dragging is disabled so users do not reorder a partial result set.

Dragging only changes UI display order. It must not run Git commands, alter branch data, change worktree directories, checkout a branch, or mutate server read models.

All view reflects the saved worktree order, but it does not expose drag handles. Ordered worktree branches appear first, then branches without worktrees keep their current branch snapshot order. This makes the saved workspace priority visible while keeping drag interaction scoped to the Worktrees view.

Both All and Worktrees views show the linked directory on rows that have a worktree. Branches without worktrees remain single-line except for their existing metadata.

## State And Data Flow

Add a per-repository UI field:

```ts
interface RepoUiState {
  selectedBranch: string | null
  branchViewMode: BranchViewMode
  detailTab: DetailTab
  worktreePathOrder: string[]
}
```

`worktreePathOrder` stores worktree directory paths, not branch names. This preserves ordering when a branch is renamed but the worktree directory stays the same. If a worktree path changes, the new path is treated as a new unordered item.

The cache schema should persist and hydrate the field through `CachedRepoState.ui`. Normalization should accept missing or invalid order data by falling back to an empty array. Persisted paths that no longer exist should be ignored during display and naturally dropped on the next cache write.

Add a store action such as:

```ts
reorderWorktrees(repoId: string, fromPath: string, toPath: string): void
```

The action should:

- No-op when the repository is missing.
- No-op when either path is missing from the current linked worktree set.
- Move `fromPath` to `toPath` using the same shift semantics as existing dnd-kit `arrayMove` usage.
- Build the next order from current linked worktree paths so stale paths are removed.
- Persist the repo cache after a successful change.

## Ordering Rules

Ordering should be handled by a small helper near `branch-view-mode.ts`, keeping list semantics testable outside React.

For Worktrees view:

- Filter to branches with `branch.worktree.path`.
- Apply search filtering.
- Sort by `worktreePathOrder` after filtering.
- Worktree paths not present in the saved order append after ordered paths in the original branch snapshot order.
- When search query is active, keep this display order but disable drag handles.

For All view:

- Apply search filtering.
- Branches with worktrees are sorted by `worktreePathOrder`.
- Branches without worktrees append after the worktree group in original branch snapshot order.
- Search filtering still applies before grouping so search results remain focused.

For No Worktree view:

- Keep the existing filtered branch snapshot order.

The helper should not mutate branch arrays.

## UI Components

`BranchList` should compute whether dragging is enabled:

```text
branchViewMode === "worktrees" && searchQuery.trim() === ""
```

When enabled, it wraps the worktree rows in dnd-kit context and passes sortable row props to `BranchRow`. When disabled, it renders the existing non-sortable list shape.

`BranchRow` should keep existing click, double-click, action menu, selected state, and keyboard behavior. The drag handle should be its own hit target so starting a drag does not accidentally select or activate the row.

`BranchSummaryInline` should render the worktree directory as a second line only when `branch.worktree.path` exists. Local paths should use `~` where applicable. Remote paths should show only the remote filesystem path, without a `user@host:` or host/IP prefix.

The row layout must keep action buttons reachable, prevent path text from pushing controls out of bounds, and left-ellipsize or truncate long paths consistently with existing path display helpers.

## Edge Cases

- Branch rename with the same worktree path keeps the custom order.
- Worktree directory change creates a new unordered item appended after ordered worktrees.
- Worktree deletion removes the path from the effective order.
- New linked worktree paths append after ordered worktrees.
- Search disables dragging but still displays directories.
- Remote repositories use the same `branch.worktree.path` identity. In this list, remote rows display only the remote filesystem path, without host/IP prefix text.
- Cache expiry or eviction may lose the custom order.

## Testing

Add focused coverage:

- Ordering helper tests for Worktrees, All, No Worktree, missing order paths, new paths, and search behavior.
- Store action tests for valid reorder, missing repository, stale paths, stale path cleanup, and repo cache persistence.
- Persistence tests for hydrate, normalize missing order data, reject invalid order data, and persist `worktreePathOrder`.
- Component tests proving directories render in All and Worktrees views but not for branches without worktrees.
- Component tests proving drag handles appear only in Worktrees view with an empty search query.
- Component tests proving search disables drag handles while keeping directory display.

## Verification

Implementation should pass:

```text
bun run typecheck
bun run test
bun run check:architecture
```

Manual verification should cover:

- Open a repository with multiple linked worktrees.
- Confirm All and Worktrees views show worktree directories.
- Reorder worktrees in the Worktrees view with no search query.
- Confirm All view reflects the saved worktree order and has no drag handles.
- Enter a search query and confirm drag handles are disabled while directories remain visible.
- Restart the app or reload persisted state and confirm the order is restored while the repository cache is valid.
