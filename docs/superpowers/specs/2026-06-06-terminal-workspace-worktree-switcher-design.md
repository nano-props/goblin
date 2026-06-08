# Terminal Workspace Worktree Switcher Design

## Summary

The Android repository Terminal tab should support switching the active terminal workspace between the repository root and every known worktree. Closing or deleting a terminal session from this workspace should always require a confirmation dialog before the existing delete/stop flow runs.

## Goals

- Let users switch worktrees from inside the Terminal tab without returning to Branches or Worktrees.
- Include the repository root and every `snapshot.worktrees` path as selectable terminal workspaces.
- Keep `New terminal`, terminal list filtering, and terminal counts scoped to the selected workspace.
- Require a second confirmation for every terminal close/delete action.

## Non-goals

- Do not change terminal session identity, persistence, or host matching semantics.
- Do not change how terminal sessions are created, opened, or deleted after confirmation.
- Do not filter out missing, locked, detached, or dirty worktrees from the selector.
- Do not add a global workspace selector outside the Terminal tab.
- Do not change Branches or Worktrees item behavior.

## Current State

`RepositoryDetailScreen` owns `selectedTerminalWorkspacePath`.

Branches and Worktrees can set that path and switch into the Terminal tab through existing callbacks. Once inside the Terminal tab, the user can create, open, and delete terminal sessions for the currently selected path, but cannot switch to another worktree from within the Terminal tab.

Terminal delete confirmation currently depends on session state. The new behavior requires confirmation for all close/delete requests from the Terminal workspace.

## Selected Approach

Add a worktree selector inside `RepositoryTerminalPanel`.

The parent screen should derive terminal workspace options from the loaded repository snapshot:

1. Repository root path.
2. Every worktree path in `snapshot.worktrees`.

The Terminal panel should receive the options, current path, and an `onSelectWorkspace(path)` callback. Changing the selection updates `selectedTerminalWorkspacePath`, and the existing terminal session calculations should recompute from the selected path.

This keeps the change local to the repository workspace UI and avoids new terminal data model concepts.

## Workspace Selector Behavior

The selector appears in the Terminal tab summary card above `New terminal`.

Each option should show:

- A readable label.
- The remote path.
- Existing terminal count for that path when available.

Recommended labels:

- Repository root: repository title or `Repository root`.
- Worktree: derived worktree title using the existing worktree title pattern.

Selecting an option should:

- Update the active terminal workspace path.
- Keep the user on the Terminal tab.
- Recompute visible sessions for the selected path.
- Make `New terminal` create a terminal at the selected path.

## Close/Delete Confirmation Behavior

Every terminal close/delete request from the Terminal workspace should show a confirmation dialog before calling the existing delete callback.

The dialog should continue to use terminal session context:

- Display the terminal label.
- Display the remote path.
- Explain whether an active terminal will be stopped when applicable.

The confirmation action should call the existing delete flow. The cancel action should dismiss without changing the terminal session.

## Data Flow

Parent screen responsibilities:

- Keep `selectedTerminalWorkspacePath` as the source of truth.
- Build workspace selector options from the current repository and snapshot.
- Pass current path, options, and `onSelectWorkspace` to `RepositoryTerminalPanel`.
- Keep terminal delete confirmation state in the existing parent-level dialog state.

Terminal panel responsibilities:

- Render the selector.
- Call `onSelectWorkspace(path)` when the user chooses a workspace.
- Continue deriving visible terminal sessions from the current `path`.
- Continue using existing callbacks for new/open/delete actions.

## Error Handling

No new network or persistence error handling is required.

- Snapshot load failures should keep using existing `SnapshotContent` behavior.
- Terminal creation failures should keep using the existing parent `actionError` path.
- Delete failures should keep using the existing parent `actionError` path.

## Testing

Recommended verification after implementation:

- Compile Android Kotlin.
- Open a repository with at least one worktree.
- Enter the Terminal tab and switch between repository root and worktrees.
- Confirm the terminal list and count update for the selected path.
- Confirm `New terminal` creates a terminal for the selected path.
- Confirm deleting any terminal opens a confirmation dialog before deletion.
- Confirm canceling the dialog leaves the terminal session intact.

## Implementation Scope

Expected source file:

- `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

The implementation should prefer local data classes/helpers in this file over broader architecture changes.
