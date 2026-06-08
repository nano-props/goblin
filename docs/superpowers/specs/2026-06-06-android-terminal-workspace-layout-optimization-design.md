# Android Terminal Workspace Layout Optimization Design

## Summary

The Android repository Terminal tab should use a compact command area and narrow-screen-friendly terminal session rows.

This is a layout-only change. It must not change terminal session identity, workspace path selection, host matching, terminal creation, terminal opening, delete confirmation, or delete execution behavior.

## Goals

- Reduce repeated path and count text in the Terminal tab header card.
- Make the current terminal workspace easier to scan on narrow Android screens.
- Keep workspace switching and terminal creation visible in the same command area.
- Make terminal session rows use a column layout with actions reserved for the final row.
- Preserve existing callbacks, filtering, session ordering, and confirmation behavior.

## Non-goals

- Do not introduce a global workspace selector outside the Terminal tab.
- Do not split the Terminal tab into a new multi-pane workspace list.
- Do not change terminal persistence, ownership, reconnect, or host matching semantics.
- Do not change repository snapshot loading, stale, or error handling.
- Do not add new terminal actions, overflow menus, or swipe behavior.

## Current State

`RepositoryDetailScreen` owns `selectedTerminalWorkspacePath`.

`RepositoryTerminalPanel` receives the selected `path`, all `workspaceOptions`, all terminal `sessions`, and callbacks for workspace selection, terminal creation, terminal opening, and terminal deletion.

The current Terminal tab header card displays:

1. `Terminal workspace`.
2. The selected path.
3. A terminal count sentence.
4. `Workspace`.
5. A full-width dropdown button.
6. `New terminal`.

This repeats the current path and count information and consumes vertical space on phone-sized screens.

`TerminalSessionRow` currently uses a horizontal row:

- Left side: label, remote path, status, activity text.
- Right side: `Open` and `Delete`.

On narrow screens, the action column competes with the session text. The remote path is also redundant because the list is already scoped to the selected workspace.

## Selected Approach

Use a local layout refactor inside `RepositoryTerminalPanel` and `TerminalSessionRow`.

The Terminal tab should present one compact command card:

1. Current workspace summary.
2. Workspace switch control.
3. New terminal action.

Terminal session cards should use a column layout:

1. Identity and status.
2. Activity metadata.
3. Action row.

This keeps the implementation small, avoids new state concepts, and follows the existing Android repository workspace pattern where item cards put actions in the final row.

## Terminal Workspace Command Card

The header card should render in this order:

1. A top row with the selected workspace label on the left and a terminal count chip on the right.
2. The selected workspace path below the label, single-line with ellipsis.
3. A command row containing:
   - `Switch workspace` dropdown trigger.
   - `New terminal` action.

The selected workspace label should come from `selectedWorkspaceOption.label`.

The selected workspace path should come from the selected option path, normalized consistently with the existing selected path comparison. It should remain visible but not repeated elsewhere in the session list.

The terminal count chip should use the existing `activeWorktreeCount` value. Recommended text:

- `1 terminal`
- `<n> terminals`

The command row should keep both actions discoverable. If the row becomes too narrow, Compose may wrap or stack controls naturally; the behavior must remain equivalent.

## Workspace Dropdown

The dropdown should continue to render all `workspaceOptions`.

Each option should continue to show:

- The option label.
- The option path.
- The terminal count for that path.

Selecting an option should still:

- Dismiss the menu.
- Call `onSelectWorkspace(option.path)`.
- Keep the user in the Terminal tab through the existing parent callback.

No new workspace filtering or sorting is introduced.

## Terminal Session Row

Each terminal session card should render in this order:

1. Top row:
   - Terminal label on the left.
   - Status chip on the right.
2. Activity text below the top row.
3. Final action row:
   - `Open`.
   - `Delete`.

The full remote path should not be shown inside each row because every visible row is already scoped to the selected terminal workspace. This removes redundant text and makes session cards easier to scan.

The row remains clickable to open the terminal session. The `Open` button should keep calling the same open callback. The `Delete` button should keep calling the same delete callback with the same label.

The swipe-to-delete wrapper should remain unchanged and continue to trigger the same delete request path.

## Data Flow

No data flow changes are required.

Parent screen responsibilities remain:

- Own `selectedTerminalWorkspacePath`.
- Derive `workspaceOptions` from the repository root and snapshot worktrees.
- Pass `path`, `workspaceOptions`, `sessions`, and callbacks to `RepositoryTerminalPanel`.
- Keep delete confirmation state and action error state.

Terminal panel responsibilities remain:

- Compute terminal host ids for the selected path.
- Compute session counts by workspace path.
- Compute visible sessions for the selected path.
- Render the workspace selector and current session list.
- Call existing callbacks for workspace selection, terminal creation, terminal opening, and delete requests.

Terminal session row responsibilities remain:

- Render one session summary.
- Trigger the existing open and delete callbacks.

## Error Handling

No new error handling is required.

- Snapshot loading, stale, and error states remain handled by `SnapshotContent`.
- Terminal creation failures continue to use the parent `actionError` path.
- Terminal delete failures continue to use the existing parent delete flow.
- Delete confirmation behavior remains unchanged.

## Testing And Verification

Automated verification:

- Run Android Kotlin compilation.
- Run existing repository setup state tests.

Manual verification on a narrow Android screen:

- Open the Terminal tab.
- Confirm the top card shows one current workspace summary, one path, one count, a workspace switch action, and a new terminal action.
- Switch between repository root and a worktree.
- Confirm the terminal count and visible session list update for the selected workspace.
- Create a new terminal and confirm it is created for the selected workspace.
- Open an existing terminal from both the card click target and `Open`.
- Delete through the `Delete` button and confirm the existing confirmation dialog appears.
- Swipe-delete a terminal row and confirm the same confirmation path appears.

## Implementation Scope

Expected source file:

- `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

Expected tests:

- Existing tests in `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt` should continue to pass.
- Add helper-level tests only if a new formatting helper is introduced for terminal count text.

## Engineering Principles

- KISS: prefer local layout changes in existing composables over new screens, state models, or abstractions.
- YAGNI: do not add an always-visible workspace list or overflow action model before there is a demonstrated need.
- DRY: keep existing session filtering, count, label, and callback helpers as the single source of truth.
- SOLID: preserve parent ownership of state and keep row components focused on rendering and dispatching callbacks.
