# Android Remote Repository Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 2 remote repository read behavior for Android without local cloning or Git write operations.

**Architecture:** Extend the existing SSH read boundary instead of replacing it. `RemoteRepositoryGitService` remains the single SSH/Git read service; Compose screens consume parsed domain models and keep persistent repository records separate from runtime snapshots.

**Tech Stack:** Kotlin, Jetpack Compose, SSHJ, JUnit, Android SharedPreferences.

---

### Task 1: Remote Browse And Save Validation

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/domain/ssh/RemoteRepositorySnapshot.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ssh/RemoteRepositoryGitService.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ssh/RemoteRepositoryGitServiceTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] Add failing parser/service tests for remote directory listing and Git repository inspection.
- [ ] Implement `RemoteDirectoryEntry` and `RemoteRepositoryInspection`.
- [ ] Add `browseDirectories()` and `inspectRepository()` read methods using host-key trust.
- [ ] Add Add Project browse/validate/save UI state.
- [ ] Verify with targeted tests.

### Task 2: Rich Repository Snapshot

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/domain/ssh/RemoteRepositorySnapshot.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ssh/RemoteRepositoryGitService.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ssh/RemoteRepositoryGitServiceTest.kt`

- [ ] Add failing tests for default branch, recent commits, dirty counts, locked worktrees, missing worktrees, and linked worktrees.
- [ ] Extend snapshot models with `defaultBranch`, `commits`, `changeCount`, `isDirty`, `isLocked`, and `isMissing`.
- [ ] Extend the read-only shell script with `git symbolic-ref refs/remotes/origin/HEAD`, `git log`, and per-worktree status checks.
- [ ] Verify parsing and shell quoting behavior with tests.

### Task 3: Repository Workspace States

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`
- Add: `.planning/phases/02-remote-repository-read-model/02-03-SUMMARY.md` after implementation is verified.

- [ ] Add failing UI-state tests for stale refresh fallback and workspace tab availability.
- [ ] Show commit log in the repository workspace.
- [ ] Render worktree badges for primary, linked, locked, missing, dirty, and bare.
- [ ] Keep last loaded snapshot visible as stale if manual refresh fails.
- [ ] Run `./gradlew test :app:assembleDebug` from `android/` and `git diff --check`.

