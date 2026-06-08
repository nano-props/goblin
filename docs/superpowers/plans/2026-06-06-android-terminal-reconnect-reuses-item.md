# Android Terminal Reconnect Reuses Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Android terminal reconnect reuse the selected terminal item while opening a fresh SSH shell underneath.

**Architecture:** Add an explicit `TerminalSessionManager.reconnect(sessionId, target, repositoryId, targetLabel, secrets)` path instead of routing reconnect through workspace-level `createOrAttach()`. The reconnect path keeps the old `TerminalSessionRecord` identity and display name, installs a fresh `TerminalController`, and preserves the bounded output snapshot across reconnect.

**Tech Stack:** Kotlin, Android Compose, JUnit, existing SSHJ-backed `TerminalSessionFactory`.

---

### Task 1: Manager Reconnect API

**Files:**
- Modify: `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionManager.kt`

- [x] **Step 1: Write the failing test**

Add this test near the existing reconnect/lifecycle tests:

```kotlin
@Test
fun `reconnect reuses inactive terminal record without creating a new item`() {
    val service = FakeTerminalSessionFactory()
    val manager = terminalSessionManager(service, ids = terminalIds())
    val record = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
    service.emitOutput("before\n")
    service.fail(IOException("connection lost"))

    val reconnected = manager.reconnect(
        sessionId = record.id,
        target = target(remotePath = "/srv/app"),
        repositoryId = "repo-1",
        targetLabel = "App - /srv/app",
    )

    assertEquals(record.id, reconnected?.id)
    assertEquals(record.displayName, reconnected?.displayName)
    assertEquals(record.openedAt, reconnected?.openedAt)
    assertEquals(2, service.openCount)
    assertEquals(listOf(record.id), manager.sessions().map { it.id })
    assertEquals(TerminalSessionStatus.Running, manager.session(record.id)?.status)
    assertEquals("before\n", manager.session(record.id)?.lastOutputSnapshot)
}
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest.reconnect reuses inactive terminal record without creating a new item"
```

Expected: compile failure because `TerminalSessionManager.reconnect` does not exist.

- [x] **Step 3: Implement minimal manager reconnect**

Add `reconnect(...)` to `TerminalSessionManager`. It should:

```kotlin
fun reconnect(
    sessionId: String,
    target: RemoteTarget,
    repositoryId: String?,
    targetLabel: String,
    secrets: SshConnectionSecrets = SshConnectionSecrets(),
): TerminalSessionRecord? {
    val existing = synchronized(lock) { sessions[sessionId] } ?: return null
    val controllerToClose = synchronized(lock) {
        controllers.remove(sessionId)
    }
    controllerToClose?.close()

    val starting = existing.copy(
        hostId = target.id,
        repositoryId = repositoryId,
        remotePath = target.remotePath,
        targetLabel = targetLabel,
        status = TerminalSessionStatus.Starting,
        foregroundServiceOwned = false,
        disconnectedReason = null,
        lastActivityAt = clock(),
    )
    val controller = TerminalController(
        terminalService = terminalService,
        initialOutput = existing.lastOutputSnapshot,
    ) { state ->
        handleControllerState(sessionId, state)
    }
    synchronized(lock) {
        sessions[sessionId] = starting
        controllers[sessionId] = controller
        heartbeatFailureStreaks[sessionId] = 0
    }
    persist(starting)
    notifyObservers(starting)
    controller.open(target, secrets)
    return session(sessionId)
}
```

This requires adding `initialOutput` to `TerminalController` in Task 2.

- [x] **Step 4: Run the focused test**

Run the same Gradle test command. Expected: PASS after Task 2 is complete.

### Task 2: Preserve Output Across Controller Reopen

**Files:**
- Modify: `android/app/src/test/java/dev/goblin/android/terminals/TerminalControllerTest.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/terminals/TerminalController.kt`

- [x] **Step 1: Write the failing test**

Add:

```kotlin
@Test
fun `open can preserve existing output for reconnect`() {
    val service = FakeTerminalSessionFactory()
    val controller = TerminalController(service, initialOutput = "before\n")

    controller.open(target())

    val state = controller.state as TerminalSessionState.Connected
    assertEquals("before\nready\n", state.output)
}
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalControllerTest.open can preserve existing output for reconnect"
```

Expected: compile failure because `TerminalController` has no `initialOutput` parameter.

- [x] **Step 3: Implement minimal controller support**

Change constructor and `open()` reset:

```kotlin
class TerminalController(
    private val terminalService: TerminalSessionFactory,
    initialOutput: String = "",
    private val onStateChanged: (TerminalSessionState) -> Unit = {},
) {
    private var output: String = terminalOutputSnapshot(initialOutput)

    fun open(target: RemoteTarget, secrets: SshConnectionSecrets = SshConnectionSecrets()) {
        session?.close()
        session = null
        outputFilter.reset()
        update(TerminalSessionState.Connecting)
        ...
    }
}
```

Keep the existing `MaxOutputChars` cap by using `terminalOutputSnapshot` for constructor input and the existing append cap.

- [x] **Step 4: Run controller tests**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalControllerTest"
```

Expected: PASS.

### Task 3: Wire Reconnect Button To Session Reconnect

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt`

- [x] **Step 1: Update UI reconnect path**

Change `connect()` so an inactive selected session reconnects by id:

```kotlin
fun connect() {
    scope.launch {
        val record = withContext(Dispatchers.IO) {
            val sessionId = activeSessionId
            if (sessionId != null && terminalReconnectAvailable(terminalState)) {
                terminalSessionManager.reconnect(
                    sessionId = sessionId,
                    target = target,
                    repositoryId = repositoryId,
                    targetLabel = targetLabel,
                )
            } else {
                terminalSessionManager.createOrAttach(
                    target = target,
                    repositoryId = repositoryId,
                    targetLabel = targetLabel,
                )
            }
        }
        if (record != null) {
            activeSessionId = record.id
            terminalState = record.toTerminalSessionState()
        }
        syncTerminalForeground()
    }
}
```

- [x] **Step 2: Verify no new item appears by manager test**

Run:

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest.reconnect reuses inactive terminal record without creating a new item"
```

Expected: PASS and `manager.sessions()` contains only the original id.

### Task 4: Regression Sweep

**Files:**
- Verify: `android/app/src/test/java/dev/goblin/android/terminals/TerminalSessionManagerTest.kt`
- Verify: `android/app/src/test/java/dev/goblin/android/terminals/TerminalControllerTest.kt`
- Verify: Android app unit tests if focused tests pass.

- [x] **Step 1: Add running-session guard coverage**

Add a manager test proving that `reconnect(...)` does not replace an already running terminal. Expected behavior: same record id, `openCount == 1`, backend close count remains `0`, and the session list still contains only the original id.

- [x] **Step 2: Add running-session guard implementation**

Before replacing the controller in `TerminalSessionManager.reconnect(...)`, return the touched existing record when `existing.status in attachableStatuses`. This keeps reconnect scoped to inactive terminal records and avoids accidental close/reopen side effects for active sessions.

- [x] **Step 3: Run focused terminal test classes**

```bash
./gradlew :app:testDebugUnitTest --tests "dev.goblin.android.terminals.TerminalSessionManagerTest" --tests "dev.goblin.android.terminals.TerminalControllerTest"
```

Expected: PASS.

- [x] **Step 4: Run broader verification**

```bash
./gradlew :app:testDebugUnitTest
```

Expected: PASS.

- [x] **Step 5: Do not commit unless explicitly requested**

Project instructions say not to commit unless the user asks. Leave the working tree with code and test changes only.
