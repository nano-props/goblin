# Android Hardening And Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and document Goblin Android v1 so it is ready for release review.

**Architecture:** Keep hardening as focused tests and docs. Avoid adding new runtime behavior unless a test reveals a concrete release-blocking bug.

**Tech Stack:** Kotlin, Jetpack Compose, SSHJ, JUnit, Markdown.

---

### Task 1: Focused Automated Coverage

**Files:**

- Add: `android/app/src/test/java/dev/goblin/android/domain/ssh/RemoteTargetTest.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ssh/SshDiagnosticsServiceTest.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ssh/RemoteRepositoryGitServiceTest.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/data/HostProfileStoreTest.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/data/RemoteRepositoryStoreTest.kt`
- Add: `docs/android/release/test-coverage-matrix.md`

- [ ] Add tests for SSH target normalization and identity propagation.
- [ ] Add tests for unknown host-key diagnostic mapping.
- [ ] Add Git parser coverage for detached/bare worktree states.
- [ ] Add persisted payload tests excluding runtime tunnel/session field names.
- [ ] Write the test coverage matrix mapping Phase 5 criteria to test files.

### Task 2: Security, Lifecycle, And UAT Review

**Files:**

- Add: `docs/android/release/security-review.md`
- Add: `docs/android/release/lifecycle-review.md`
- Add: `docs/android/release/manual-uat.md`

- [ ] Document every secret-handling path and persistence boundary.
- [ ] Document terminal and tunnel lifecycle ownership, cleanup, and known background limitation.
- [ ] Write a phone-sized manual UAT checklist for SSH initialization, repository, worktree, terminal, and port forwarding.

### Task 3: Release Documentation And Final Verification

**Files:**

- Add: `docs/android/release/v1-release-notes.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Add: `.planning/phases/05-hardening-and-release-readiness/05-01-SUMMARY.md`
- Add: `.planning/phases/05-hardening-and-release-readiness/05-02-SUMMARY.md`
- Add: `.planning/phases/05-hardening-and-release-readiness/05-03-SUMMARY.md`

- [ ] Write v1 release notes and limitations.
- [ ] Update GSD Phase 5 completion state.
- [ ] Run `cd android && ./gradlew test :app:assembleDebug --rerun-tasks`.
- [ ] Run `git diff --check`.

