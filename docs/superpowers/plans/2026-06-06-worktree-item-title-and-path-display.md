# Worktree item title and full path display implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each worktree list item show its last path segment as the main title and include a dedicated `path: full_dir_path` subtitle, while keeping existing action buttons and terminal/worktree safety behavior intact.

**Architecture:** The change is confined to the repository workspace UI layer (`WorktreeRow`) and uses local display-only derived values from existing `RemoteRepositoryWorktree.path`. No new services, repositories, or data model changes are required.

**Tech Stack:** Kotlin, Jetpack Compose, Material3, existing `RepositorySetupScreen` UI components.

---

### Task 1: Update worktree item title and path subtitle rendering

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Add local title derivation in `WorktreeRow` before rendering**

```kotlin
@Composable
private fun WorktreeRow(
    worktree: RemoteRepositoryWorktree,
    onSelectTerminalWorkspace: (String) -> Unit,
    onRemoveWorktree: (RemoteRepositoryWorktree) -> Unit,
) {
    val removalSafety = evaluateWorktreeRemoval(worktree)
    val worktreeTitle = worktree.path
        .trim()
        .trimEnd('/')
        .substringAfterLast('/', missingDelimiterValue = worktree.path)
        .ifBlank { worktree.path }

    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                Modifier
                    .weight(1f)
                    .padding(end = GoblinSpacing.Xs),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
            ) {
                Text(
                    text = worktreeTitle,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text = "path: ${worktree.path}",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(worktree.branch ?: "detached", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                    worktreeBadges(worktree).forEach { badge ->
                        Text(badge, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                TextButton(
                    onClick = { onSelectTerminalWorkspace(worktreeTerminalPath(worktree)) },
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                ) {
                    Text("Terminals", style = MaterialTheme.typography.labelMedium)
                }
                if (removalSafety.allowed) {
                    TextButton(
                        onClick = { onRemoveWorktree(worktree) },
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                    ) {
                        Text("Remove", style = MaterialTheme.typography.labelMedium)
                    }
                } else {
                    Text(removalSafety.reason.orEmpty(), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
```

- [ ] **Step 2: Keep existing behavior unchanged and preserve import set**

- No signature changes required on `WorktreeRow`; keep `onSelectTerminalWorkspace` and `onRemoveWorktree` unchanged.
- Confirm `PaddingValues` and `dp` imports already exist before implementation; if not, include these exact imports:

```kotlin
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.unit.dp
```

- If `dp` is already imported elsewhere, do not add duplicate imports.

- [ ] **Step 3: Verify compile-time consistency manually in this task (no execution in plan phase)**

- Ensure the `worktree.path` string for title never throws on empty values by using `substringAfterLast` with `missingDelimiterValue = worktree.path` and fallback `ifBlank`.
- Ensure `path:` subtitle uses the full path directly, with no transformation.
- Ensure button labels remain `Terminals` and `Remove`.

- [ ] **Step 4: Commit this worktree UI update**

```bash
git add android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt

git commit -m "feat: show worktree title and full path in list item"
```

### Self-review checklist

1. **Spec coverage:**
   - 目标改动（标题短名） → Task 1 Step 1
   - full path 显示（`path: ...`） → Task 1 Step 1
   - 既有交互保留（Terminals/Remove） → Task 1 Step 1/2
   - 局部实现、无模型变更 → Task 1 Step 2

2. **Placeholder scan:**
   - 无 `TODO` / `TBD` / 未定义变量。

3. **Type consistency:**
   - 仅使用 `RemoteRepositoryWorktree.path: String` 与现有 `evaluateWorktreeRemoval(worktree)` 签名。
   - 所有新增文本参数为 `String`，与 `Text` API 一致。
