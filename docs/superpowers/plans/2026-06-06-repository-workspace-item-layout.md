# Repository Workspace Item Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android repository Branches and Worktrees item cards use a consistent column layout with the final row reserved for actions only.

**Architecture:** This is a presentation-only change in the existing Compose screen. Keep current callbacks, helper functions, enablement rules, and dialogs unchanged. Prefer direct edits inside the existing row composables over extracting a shared card abstraction because the scope is two small layout adjustments.

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, existing Android app module.

---

## File Structure

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
  - `BranchRow`: convert the card body from a horizontal `Row` split into a vertical `Column`.
  - `WorktreeRow`: keep the existing vertical layout, but move the blocked removal reason above the final action row.

No new source files are needed.

No git commit is included in this plan because the project instructions say not to plan or execute git commits unless the user explicitly requests them.

---

### Task 1: Convert BranchRow to Column Layout

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Replace the `BranchRow` card content with a column**

Replace the body of `BranchRow` with this implementation:

```kotlin
@Composable
private fun BranchRow(
    branch: RemoteRepositoryBranch,
    onSelectTerminalWorkspace: (String) -> Unit,
    onCheckoutBranch: (RemoteRepositoryBranch) -> Unit,
    onDeleteBranch: (RemoteRepositoryBranch) -> Unit,
) {
    val deleteBlockedReason = branchDeleteBlockedReason(branch)
    Card(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            Text(
                branch.name,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                branch.worktreePath ?: "no worktree",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                if (branch.isCurrent) Text("current", style = MaterialTheme.typography.labelMedium)
                if (branch.isDefault) Text("default", style = MaterialTheme.typography.labelMedium)
            }
            deleteBlockedReason?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                branch.worktreePath?.let { path ->
                    TextButton(onClick = { onSelectTerminalWorkspace(path) }) {
                        Text("Terminals")
                    }
                }
                TextButton(
                    enabled = canCheckoutBranch(branch),
                    onClick = { onCheckoutBranch(branch) },
                ) {
                    Text("Checkout")
                }
                TextButton(
                    enabled = deleteBlockedReason == null,
                    onClick = { onDeleteBranch(branch) },
                ) {
                    Text("Delete")
                }
            }
        }
    }
}
```

Expected behavior:
- Branch details stack vertically.
- Branch action buttons remain in the order `Terminals`, `Checkout`, `Delete`.
- `Terminals` still appears only when `branch.worktreePath` exists.
- `Checkout` and `Delete` preserve existing enablement logic.

---

### Task 2: Make WorktreeRow Final Row Actions-Only

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Replace the bottom section of `WorktreeRow`**

Inside `WorktreeRow`, keep the existing title, summary, path, and `actionButtonPadding` setup. Replace the current bottom `Row` that mixes `removalSafety.reason` and actions with this block:

```kotlin
            if (!removalSafety.allowed) {
                Text(
                    removalSafety.reason.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = { onSelectTerminalWorkspace(worktreeTerminalPath(worktree)) },
                    contentPadding = actionButtonPadding,
                ) {
                    Text("Terminals", style = MaterialTheme.typography.labelMedium)
                }
                if (removalSafety.allowed) {
                    TextButton(
                        onClick = { onRemoveWorktree(worktree) },
                        contentPadding = actionButtonPadding,
                    ) {
                        Text("Remove", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
```

Expected behavior:
- Worktree removal blocked reason appears above the final row.
- Final row contains only `Terminals` and, when allowed, `Remove`.
- Button order remains `Terminals`, `Remove`.
- Existing remove safety behavior remains unchanged.

---

### Task 3: Verify Layout and Behavior

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

- [ ] **Step 2: Manually inspect the Branches tab**

Use the Android app and open a repository workspace with branches.

Expected:
- Branch cards are vertical.
- Branch name is on top.
- Worktree path or `no worktree` appears below the name.
- Status badges appear below the path.
- Delete-blocked reason appears above the final action row.
- Final row contains only action buttons, right-aligned.

- [ ] **Step 3: Manually inspect the Worktrees tab**

Use the Android app and open a repository workspace with worktrees.

Expected:
- Worktree title, summary, and path remain in the same order.
- Removal-blocked reason appears above the final action row.
- Final row contains only `Terminals` and optionally `Remove`, right-aligned.

- [ ] **Step 4: Check preserved interactions**

Confirm these interactions still call the existing flows:
- Branch `Terminals` opens the terminal workspace for the branch worktree path.
- Branch `Checkout` opens the existing checkout confirmation when enabled.
- Branch `Delete` opens the existing delete confirmation when enabled.
- Worktree `Terminals` opens the terminal workspace for the worktree path.
- Worktree `Remove` opens the existing removal confirmation when allowed.

---

## Self-Review

- Spec coverage: The plan covers the selected A layout, final action row behavior, branch layout, worktree layout, data-flow preservation, and verification.
- Placeholder scan: No placeholder steps are included.
- Type consistency: The plan uses existing Compose imports, existing callbacks, and existing helper functions from `RepositorySetupScreen.kt`.
- Scope check: The plan is limited to one source file and does not introduce new abstractions, behavior changes, or git operations.
