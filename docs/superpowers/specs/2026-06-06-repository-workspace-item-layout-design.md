# Repository Workspace Item Layout Design

## Summary

Branches and worktrees in the Android repository workspace should use a consistent column card layout. Each item should present identity and metadata first, then reserve the final row for actions only.

This is a layout-only change. It must not change branch, worktree, terminal, delete, checkout, remove, or confirmation behavior.

## Goals

- Make branch and worktree items easier to scan on narrow Android screens.
- Align branch item layout with the existing column direction used by worktree items.
- Keep the final row of each item as the action area.
- Preserve existing button order, visibility, enablement, and callbacks.

## Non-goals

- Do not introduce a shared item abstraction unless the implementation needs it to avoid obvious duplication.
- Do not add overflow menus or change action discoverability.
- Do not alter snapshot loading, branch creation, worktree creation, terminal selection, or confirmation dialog behavior.
- Do not change labels or copy beyond moving existing text to the new layout.

## Current State

`BranchRow` uses a horizontal layout:

- Left side: branch name, worktree path or `no worktree`, status badges, delete-blocked reason.
- Right side: actions.

`WorktreeRow` already uses a column layout:

- Top: worktree title.
- Middle: summary and path.
- Bottom row: removal-blocked reason on the left and actions on the right.

The requested target is a consistent column layout for both item types, with the last row treated as an action area.

## Selected Approach

Use the minimal layout adjustment.

- Convert `BranchRow` from `Row` to `Column`.
- Keep `WorktreeRow` as a `Column`.
- Move non-action status text out of the final row.
- Keep actions in the final row, right-aligned.

This keeps the change small and avoids premature abstraction.

## Branch Item Layout

The branch card should render in this order:

1. Branch name.
2. Worktree path, or `no worktree` if absent.
3. Status badges: `current`, `default`.
4. Delete-blocked reason, if present.
5. Action row.

The final action row should preserve the existing action order:

1. `Terminals`, only when `branch.worktreePath` exists.
2. `Checkout`, enabled according to `canCheckoutBranch(branch)`.
3. `Delete`, enabled only when `branchDeleteBlockedReason(branch) == null`.

The action row should be right-aligned and should not contain status or blocked-state text.

## Worktree Item Layout

The worktree card should render in this order:

1. Worktree title.
2. Workspace summary, if non-empty.
3. Worktree path.
4. Removal-blocked reason, if removal is not allowed.
5. Action row.

The final action row should preserve the existing action order:

1. `Terminals`.
2. `Remove`, only when removal is allowed.

The action row should be right-aligned and should not contain the removal-blocked reason.

## Data Flow

No data flow changes are required.

- `BranchRow` keeps receiving `RemoteRepositoryBranch` and the same callbacks.
- `WorktreeRow` keeps receiving `RemoteRepositoryWorktree` and the same callbacks.
- Existing helper functions remain responsible for enablement and blocked-state messages.

## Error Handling

No error handling changes are required.

- Branch checkout/delete errors remain handled by the parent repository workspace screen.
- Worktree removal errors remain handled by the parent repository workspace screen.
- Confirmation dialogs remain unchanged.

## Testing

Recommended verification after implementation:

- Run Android Kotlin compilation.
- Manually inspect the Branches tab on a narrow Android viewport.
- Manually inspect the Worktrees tab on a narrow Android viewport.
- Confirm branch action callbacks still open the same dialogs or terminal workspace.
- Confirm worktree action callbacks still open terminals or removal confirmation as before.

## Implementation Scope

Expected source file:

- `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

The implementation should prefer direct layout changes over new abstractions unless repeated code becomes materially harder to maintain.
