# Android Port Forwarding And Emergency UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSH local port forwarding, repository Ports UI, and phone emergency workflow polish.

**Architecture:** Introduce a runtime-only port-forward model plus manager with a fakeable backend. Keep SSHJ-specific socket/listener code behind the backend, and keep repository UI as orchestration over session snapshots.

**Tech Stack:** Kotlin, Jetpack Compose, SSHJ, JUnit.

---

### Task 1: Port Forward Model And Manager

**Files:**

- Add: `android/app/src/main/java/dev/goblin/android/domain/ssh/PortForwardModels.kt`
- Add: `android/app/src/main/java/dev/goblin/android/ssh/SshPortForwardService.kt`
- Test: `android/app/src/test/java/dev/goblin/android/domain/ssh/PortForwardModelsTest.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ssh/SshPortForwardServiceTest.kt`

- [ ] Add failing model tests for default remote host, local port `0`, URL formatting, and invalid ports.
- [ ] Implement `PortForwardRequest`, `PortForwardOwner`, `PortForwardSession`, and session status types.
- [ ] Add failing manager tests for start, stop, backend failure, and owner cleanup using a fake backend.
- [ ] Implement `PortForwardManager`, `PortForwardBackend`, and production `SshjPortForwardBackend`.
- [ ] Verify targeted tests with `cd android && ./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.domain.ssh.PortForwardModelsTest" --tests "dev.goblin.android.ssh.SshPortForwardServiceTest"`.

### Task 2: Repository Ports UI

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/MainActivity.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] Add failing UI-state tests for `Ports` tab presence, create enablement, URL action labels, and active tunnel visibility text.
- [ ] Wire `PortForwardManager` into app composition.
- [ ] Add `RepositoryPortsPanel` with remote port, optional local port, start, stop, copy URL, and open URL actions.
- [ ] Keep tunnel state runtime-only and scoped to repository owner id.
- [ ] Verify repository UI-state tests.

### Task 3: Emergency UX And Local Terminal Placeholder

**Files:**

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/placeholders/PlaceholderScreens.kt`
- Test: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] Add failing tests for tunnel lifecycle helper copy and local terminal placeholder text.
- [ ] Add visible session lifecycle text for active app-runtime tunnels.
- [ ] Add a local terminal placeholder entry that states Android-local shell/Git are deferred from v1.
- [ ] Re-run full verification with `cd android && ./gradlew test :app:assembleDebug --rerun-tasks` and `git diff --check`.

