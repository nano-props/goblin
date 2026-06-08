# Android Worktree Terminal MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worktree-scoped terminal workflows, remote worktree creation, and safe remote worktree removal.

**Architecture:** Reuse the existing SSH terminal and repository workspace. Add `RemoteWorktreeService` for explicit worktree mutations, keeping `RemoteRepositoryGitService` focused on read snapshots.

**Tech Stack:** Kotlin, Jetpack Compose, SSHJ, JUnit.

---

### Task 1: Worktree-Scoped Terminal State

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminal/TerminalInteractionState.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/terminal/TerminalInteractionStateTest.kt`

- [ ] Add failing tests for worktree terminal target labels and path selection.
- [ ] Implement small helpers that keep repository/worktree terminal path decisions explicit.
- [ ] Verify targeted UI-state tests.

### Task 2: Remote Worktree Create

**Files:**

- Add: `android/app/src/main/java/dev/goblin/android/ssh/RemoteWorktreeService.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/MainActivity.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ssh/RemoteWorktreeServiceTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] Add failing service tests for create script, shell quoting, and host-key trust blocking.
- [ ] Add failing UI-state tests for default worktree path suggestion.
- [ ] Implement `RemoteWorktreeService.createWorktree()`.
- [ ] Add repository UI fields/actions to create a worktree and refresh the snapshot.

### Task 3: Safe Worktree Removal

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/ssh/RemoteWorktreeService.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ssh/RemoteWorktreeServiceTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] Add failing tests for blocked primary, dirty, locked, missing, and protected-branch removals.
- [ ] Implement `WorktreeRemovalSafety` and confirmation text helper.
- [ ] Implement `RemoteWorktreeService.removeWorktree()` with read-before-remove checks.
- [ ] Add repository UI remove action only for safe linked worktrees.
- [ ] Verify with `./gradlew test :app:assembleDebug --rerun-tasks` and `git diff --check`.

