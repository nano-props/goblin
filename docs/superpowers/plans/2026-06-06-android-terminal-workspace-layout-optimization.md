# Android Terminal Workspace Layout Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Android repository Terminal tab so the workspace command area and terminal session rows scan cleanly on narrow screens.

**Architecture:** Keep the change local to `RepositorySetupScreen.kt`. The parent screen continues to own terminal workspace selection and delete confirmation state; `RepositoryTerminalPanel` only changes how the current workspace command area is rendered, and `TerminalSessionRow` only changes single-session layout. A small helper formats terminal count text so the new label is covered by the existing state test suite.

**Tech Stack:** Kotlin, Android Jetpack Compose, Material3, JUnit, Gradle Android unit tests.

---

## File Structure

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
  - Add `terminalWorkspaceCountLabel(count: Int)`.
  - Replace the current `RepositoryTerminalPanel` header card layout.
  - Replace the current `TerminalSessionRow` horizontal layout with a column layout.
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`
  - Add helper-level coverage for terminal count label singular/plural behavior.

No new source files are needed. No git commit should be performed unless the user explicitly asks for it.

---

### Task 1: Add Terminal Count Label Helper

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt:254-260`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt:197-209`

- [ ] **Step 1: Write the failing test**

Add this test near the existing terminal workspace label/status tests in `RepositorySetupStateTest.kt`:

```kotlin
    @Test
    fun `terminal workspace count label handles singular and plural`() {
        assertEquals("0 terminals", terminalWorkspaceCountLabel(0))
        assertEquals("1 terminal", terminalWorkspaceCountLabel(1))
        assertEquals("2 terminals", terminalWorkspaceCountLabel(2))
    }
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: compile/test failure because `terminalWorkspaceCountLabel` does not exist.

- [ ] **Step 3: Add the minimal helper**

In `RepositorySetupScreen.kt`, add the helper directly after `terminalWorkspaceOptionLabel(path: String)`:

```kotlin
internal fun terminalWorkspaceCountLabel(count: Int): String =
    if (count == 1) "1 terminal" else "$count terminals"
```

The nearby helper block should read:

```kotlin
internal fun terminalWorkspaceOptionLabel(path: String): String =
    path.trim()
        .trimEnd('/')
        .substringAfterLast('/', missingDelimiterValue = path)
        .ifBlank { path }

internal fun terminalWorkspaceCountLabel(count: Int): String =
    if (count == 1) "1 terminal" else "$count terminals"

internal fun terminalSessionDefaultLabel(index: Int): String = terminalSessionDisplayName(index)
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: `RepositorySetupStateTest` passes.

- [ ] **Step 5: Inspect the diff without committing**

Run from the repository root:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt" "android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt"
```

Expected result: only the new helper and test are present for this task.

---

### Task 2: Refactor Terminal Workspace Command Card

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt:1604-1665`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] **Step 1: Confirm the helper test still passes before layout work**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: pass.

- [ ] **Step 2: Replace the header card content**

In `RepositoryTerminalPanel`, replace the current `Card` content with this layout. Keep the surrounding computed values and the session list below the card unchanged.

```kotlin
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                    ) {
                        Text(selectedWorkspaceOption.label, style = MaterialTheme.typography.titleMedium)
                        Text(
                            selectedWorkspaceOption.path,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth(),
                            maxLines = 1,
                            softWrap = false,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        terminalWorkspaceCountLabel(activeWorktreeCount),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(
                        modifier = Modifier.weight(1f),
                        onClick = { workspaceMenuExpanded = true },
                    ) {
                        Text(
                            "Switch workspace",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Button(onClick = { onCreateTerminalAtPath(path) }) {
                        Text("New terminal", maxLines = 1)
                    }
                }
                DropdownMenu(
                    expanded = workspaceMenuExpanded,
                    onDismissRequest = { workspaceMenuExpanded = false },
                ) {
                    workspaceOptions.forEach { option ->
                        val optionPath = terminalSessionRemotePath(option.path)
                        val count = workspaceSessionCounts.find { it.first == optionPath }?.second ?: 0
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(option.label)
                                    Text(
                                        "${option.path} · ${terminalWorkspaceCountLabel(count)}",
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
            }
        }
```

This removes the repeated `Terminal workspace`, selected path, count sentence, and `Workspace` label while preserving the dropdown and create callbacks.

- [ ] **Step 3: Run Android Kotlin compilation**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected result: Kotlin compilation passes.

- [ ] **Step 4: Run the focused repository setup tests**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: tests pass.

- [ ] **Step 5: Inspect the diff without committing**

Run from the repository root:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt"
```

Expected result: `RepositoryTerminalPanel` still computes the same values, calls the same callbacks, and only changes the header card layout and count text formatting.

---

### Task 3: Refactor Terminal Session Row Layout

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt:1747-1779`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] **Step 1: Confirm current compile/test state before row work**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: both commands pass.

- [ ] **Step 2: Replace `TerminalSessionRow` content**

Replace the body of `TerminalSessionRow` with this column layout:

```kotlin
    Card(
        Modifier
            .fillMaxWidth()
            .clickable { onOpenTerminalSession(session) },
    ) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    terminalSessionStatusLabel(session),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                terminalSessionActivityText(session),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = { onOpenTerminalSession(session) }) {
                    Text("Open")
                }
                TextButton(onClick = { onDeleteTerminalSession(session, label) }) {
                    Text("Delete")
                }
            }
        }
    }
```

The row no longer renders `session.remotePath`; the current workspace path remains visible in the command card.

- [ ] **Step 3: Run Android Kotlin compilation**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected result: Kotlin compilation passes.

- [ ] **Step 4: Run the focused repository setup tests**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: tests pass.

- [ ] **Step 5: Inspect behavior-sensitive code paths**

Run from the repository root:

```bash
rg -n "onOpenTerminalSession|onDeleteTerminalSession|SwipeDeleteTerminalSessionRow|onCreateTerminalAtPath|onSelectWorkspace" "android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt"
```

Expected result:

- `SwipeDeleteTerminalSessionRow` still calls `onDeleteTerminalSession(session, label)`.
- `TerminalSessionRow` card click and `Open` still call `onOpenTerminalSession(session)`.
- `TerminalSessionRow` `Delete` still calls `onDeleteTerminalSession(session, label)`.
- `RepositoryTerminalPanel` `New terminal` still calls `onCreateTerminalAtPath(path)`.
- Dropdown selection still calls `onSelectWorkspace(option.path)`.

---

### Task 4: Final Verification

**Files:**
- Verify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Verify: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] **Step 1: Run Android compile**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected result: compile passes.

- [ ] **Step 2: Run Android unit tests**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest"
```

Expected result: unit tests pass.

- [ ] **Step 3: Review the final diff**

Run from the repository root:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt" "android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt"
```

Expected result:

- Only the terminal count helper, its test, the Terminal tab command card layout, and the session row layout changed.
- No terminal persistence, host matching, reconnect, delete confirmation, or repository snapshot logic changed.

- [ ] **Step 4: Manual narrow-screen Android verification**

Use a phone-sized Android emulator or device and verify:

- Terminal tab top card shows one workspace label, one path, one count, `Switch workspace`, and `New terminal`.
- Switching workspace updates the visible sessions and count.
- `New terminal` creates a terminal for the selected workspace.
- Tapping a session card opens the same terminal.
- Tapping `Open` opens the same terminal.
- Tapping `Delete` opens the existing confirmation dialog.
- Swipe-delete opens the same confirmation path.

- [ ] **Step 5: Leave git uncommitted unless explicitly requested**

Run from the repository root:

```bash
git status --short
```

Expected result: changed files are visible for review. Do not run `git commit` unless the user explicitly asks for it.

---

## Self-Review

- Spec coverage: The plan covers compact command card, workspace dropdown preservation, terminal count text, column session row, unchanged data flow, unchanged delete confirmation, and compile/test/manual verification.
- Red-flag scan: The plan contains concrete file paths, code snippets, commands, and expected results. It does not contain deferred implementation gaps.
- Type consistency: `terminalWorkspaceCountLabel(count: Int)` is introduced in Task 1 and used consistently in Task 2. Existing callback names match the current `RepositoryTerminalPanel` and `TerminalSessionRow` signatures.
