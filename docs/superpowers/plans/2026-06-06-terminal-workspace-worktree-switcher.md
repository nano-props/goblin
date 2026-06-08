# Terminal Workspace Worktree Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worktree selector inside the Android repository Terminal tab and require confirmation for every terminal close/delete action.

**Architecture:** Keep `selectedTerminalWorkspacePath` in `RepositoryDetailScreen` as the source of truth. Build terminal workspace options from the repository root and loaded snapshot worktrees, pass them into `RepositoryTerminalPanel`, and keep existing terminal create/open/delete callbacks unchanged. Confirmation stays in the existing parent dialog flow, but every delete request now opens it.

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, existing Android repository workspace screen.

---

## File Structure

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
  - Add a small local data class for terminal workspace selector options.
  - Add helpers to derive selector options from repository and snapshot state.
  - Pass options and selection callback into `RepositoryTerminalPanel`.
  - Render a dropdown selector in the Terminal tab summary card.
  - Make every terminal delete request open confirmation.

No new source files are needed.

No git commit is included in this plan because the project instructions say not to plan or execute git commits unless the user explicitly requests them.

---

### Task 1: Add Terminal Workspace Option Helpers

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Add a private selector option data class near `TerminalDeleteTarget`**

Add:

```kotlin
private data class TerminalWorkspaceOption(
    val path: String,
    val label: String,
)
```

- [ ] **Step 2: Add helper functions near existing terminal workspace helpers**

Add:

```kotlin
internal fun terminalWorkspaceOptionLabel(path: String): String =
    path.trim()
        .trimEnd('/')
        .substringAfterLast('/', missingDelimiterValue = path)
        .ifBlank { path }

private fun terminalWorkspaceOptions(
    repository: RemoteRepositoryProfile,
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
): List<TerminalWorkspaceOption> {
    val root = TerminalWorkspaceOption(
        path = repositoryTerminalPath(repository),
        label = repository.title.ifBlank { "Repository root" },
    )
    val worktrees = when (snapshotState) {
        is ResourceState.Loaded -> snapshotState.value.worktrees
        is ResourceState.Stale -> snapshotState.value.worktrees
        else -> emptyList()
    }
    return buildList {
        add(root)
        worktrees.forEach { worktree ->
            val path = worktreeTerminalPath(worktree)
            if (path != root.path) {
                add(TerminalWorkspaceOption(path = path, label = terminalWorkspaceOptionLabel(path)))
            }
        }
    }
}
```

Expected behavior:
- Repository root is always the first option.
- Worktree options are included from loaded or stale snapshots.
- Worktree path equal to repository root is skipped to avoid duplicate options.

---

### Task 2: Pass Workspace Options into RepositoryTerminalPanel

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Compute options before rendering selected tab content**

Inside `RepositoryDetailScreen`, after `workspaceTabs` is available and before the `Scaffold` content uses the selected tab, add:

```kotlin
    val terminalWorkspaceOptions = remember(repository, snapshotState) {
        terminalWorkspaceOptions(repository = repository, snapshotState = snapshotState)
    }
```

- [ ] **Step 2: Update the `RepositoryTerminalPanel` call**

Change the Terminal tab call to include:

```kotlin
                    workspaceOptions = terminalWorkspaceOptions,
                    onSelectWorkspace = { selectedTerminalWorkspacePath = it },
```

The resulting call should keep existing parameters and add the two new ones:

```kotlin
                RepositoryWorkspaceTab.Terminal -> RepositoryTerminalPanel(
                    hostProfileId = host.id,
                    targetHostId = RemoteTarget.fromHostProfile(host, selectedTerminalWorkspacePath).id,
                    path = selectedTerminalWorkspacePath,
                    workspaceOptions = terminalWorkspaceOptions,
                    sessions = terminalSessions,
                    onSelectWorkspace = { selectedTerminalWorkspacePath = it },
                    onCreateTerminalAtPath = ::createTerminal,
                    onOpenTerminalSession = onOpenTerminalSession,
                    onDeleteTerminalSession = ::requestDeleteTerminalSession,
                )
```

Expected behavior:
- Parent remains the source of truth for selected path.
- Terminal panel gets all available workspace options.

---

### Task 3: Render the Terminal Workspace Selector

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Update `RepositoryTerminalPanel` signature**

Change the signature to:

```kotlin
private fun RepositoryTerminalPanel(
    hostProfileId: String,
    targetHostId: String,
    path: String,
    workspaceOptions: List<TerminalWorkspaceOption>,
    sessions: List<TerminalSessionRecord>,
    onSelectWorkspace: (String) -> Unit,
    onCreateTerminalAtPath: (String) -> Unit,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
)
```

- [ ] **Step 2: Add dropdown state and selected option lookup**

Inside `RepositoryTerminalPanel`, after existing computed values, add:

```kotlin
    var workspaceMenuExpanded by remember(path, workspaceOptions) { mutableStateOf(false) }
    val selectedWorkspaceOption = workspaceOptions.firstOrNull { it.path == selectedPath }
        ?: TerminalWorkspaceOption(path = selectedPath, label = terminalWorkspaceOptionLabel(selectedPath))
```

- [ ] **Step 3: Add selector UI in the top Terminal card before `New terminal`**

Inside the first `Card` in `RepositoryTerminalPanel`, after the terminal count text and worktree counts list, add:

```kotlin
                Text("Workspace", style = MaterialTheme.typography.labelMedium)
                OutlinedButton(onClick = { workspaceMenuExpanded = true }) {
                    Column {
                        Text(selectedWorkspaceOption.label, style = MaterialTheme.typography.labelMedium)
                        Text(
                            selectedWorkspaceOption.path,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            softWrap = false,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                DropdownMenu(
                    expanded = workspaceMenuExpanded,
                    onDismissRequest = { workspaceMenuExpanded = false },
                ) {
                    workspaceOptions.forEach { option ->
                        val count = workspaceSessionCounts.find { it.first == terminalSessionRemotePath(option.path) }?.second ?: 0
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(option.label)
                                    Text(
                                        "${option.path} · $count terminals",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        softWrap = false,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            },
                            onClick = {
                                workspaceMenuExpanded = false
                                onSelectWorkspace(option.path)
                            },
                        )
                    }
                }
```

Expected behavior:
- The Terminal tab shows the active workspace.
- The dropdown lists repository root and all snapshot worktrees.
- Choosing a workspace updates the parent-selected path.
- Existing terminal counts continue to use normalized remote paths.

---

### Task 4: Confirm Every Terminal Close/Delete

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Change delete request behavior**

Replace `requestDeleteTerminalSession` with:

```kotlin
    fun requestDeleteTerminalSession(session: TerminalSessionRecord, label: String) {
        terminalDeleteTarget = TerminalDeleteTarget(session = session, label = label)
    }
```

- [ ] **Step 2: Update confirmation dialog title and text to handle all statuses**

Replace the existing terminal delete dialog title with:

```kotlin
            title = { Text("Delete terminal?") },
```

Keep the confirm action calling:

```kotlin
                TextButton(onClick = { deleteTerminalSession(target.session) }) {
                    Text("Stop and delete")
                }
```

Expected behavior:
- Every terminal delete/close request opens the dialog.
- Existing delete callback still runs only after confirmation.
- Running sessions still use the same delete flow that can stop the process.

---

### Task 5: Verify Behavior

**Files:**
- Verify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Compile the Android Kotlin app**

Run:

```bash
./gradlew :app:compileDebugKotlin
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 2: Manually inspect Terminal tab workspace switching**

Use a repository with at least one worktree.

Expected:
- Terminal tab displays a workspace selector.
- Selector includes repository root and all worktree paths.
- Switching selector options keeps the user on the Terminal tab.
- Terminal list changes to sessions for the selected path.
- Terminal count changes to the selected path count.
- `New terminal` creates a terminal at the selected path.

- [ ] **Step 3: Manually inspect delete confirmation**

Try deleting a running terminal and a disconnected/non-running terminal.

Expected:
- Both cases show confirmation before deletion.
- Cancel keeps the terminal session.
- Confirm calls the existing delete flow.

---

## Self-Review

- Spec coverage: The plan covers workspace options, Terminal tab selector, parent-owned selected path, terminal list/count/new terminal behavior, and universal delete confirmation.
- Placeholder scan: No placeholder steps are included.
- Type consistency: New helper names and data class are used consistently across tasks.
- Scope check: The plan is limited to `RepositorySetupScreen.kt` and does not alter terminal data models or broader architecture.
