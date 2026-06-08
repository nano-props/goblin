# Android External Termux Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository Terminal tab mode that opens the selected remote repository/worktree path in the user's installed Termux app through a safe SSH command, with copy/open fallback when direct command execution is unavailable.

**Architecture:** Command generation is pure Kotlin under `dev.goblin.android.termux`, Android intent/clipboard integration is behind a small environment interface, and repository UI only owns mode/status state. External Termux sessions are not Goblin terminal session records and do not receive Goblin private key material.

**Tech Stack:** Kotlin, Android `Intent`/`ClipboardManager`, Termux `RUN_COMMAND` service contract, Jetpack Compose Material 3, JUnit, Gradle Android unit tests.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-07-android-termux-handoff-and-runtime-design.md`: external Termux handoff only.

Out of scope for this plan:

- Embedded Termux-like local runtime.
- Exporting Goblin SSH private keys into external Termux.
- Creating `TerminalSessionRecord` entries for external Termux sessions.
- License/source-distribution release gates for embedded runtime assets.

Reference used for the Termux integration contract: <https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent>. As of 2026-06-07, the official wiki says third-party apps must request `com.termux.permission.RUN_COMMAND`, Termux must have `allow-external-apps=true`, target SDK 30+ apps need package visibility handling, and Java examples send `com.termux.RUN_COMMAND` to `com.termux.app.RunCommandService` with `RUN_COMMAND_PATH`, `RUN_COMMAND_ARGUMENTS`, `RUN_COMMAND_WORKDIR`, `RUN_COMMAND_BACKGROUND`, and `RUN_COMMAND_SESSION_ACTION` extras.

No git commit should be performed unless the user explicitly asks for it.

---

## File Structure

- Create: `android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt`
  - Builds shell-safe SSH commands for a selected remote workspace.
- Create: `android/app/src/test/java/dev/goblin/android/termux/TermuxCommandBuilderTest.kt`
  - Covers quoting, path handling, port handling, and invalid target rejection.
- Create: `android/app/src/main/java/dev/goblin/android/termux/ExternalTermuxLauncher.kt`
  - Pure launch policy over a small environment interface: direct `RUN_COMMAND`, copy/open fallback, unavailable, failed.
- Create: `android/app/src/test/java/dev/goblin/android/termux/ExternalTermuxLauncherTest.kt`
  - Covers launch policy without Android framework calls.
- Create: `android/app/src/main/java/dev/goblin/android/termux/AndroidExternalTermuxEnvironment.kt`
  - Android adapter for Termux package detection, permission detection, `RUN_COMMAND` service, clipboard, and app-open fallback.
- Create: `android/app/src/test/java/dev/goblin/android/termux/TermuxAndroidContractTest.kt`
  - Static tests for Manifest declarations and hardcoded Termux contract constants.
- Modify: `android/app/src/main/AndroidManifest.xml`
  - Adds `com.termux.permission.RUN_COMMAND` and Android 11+ package visibility declarations.
- Modify: `android/app/src/main/java/dev/goblin/android/MainActivity.kt`
  - Creates the Android Termux environment and launcher once.
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`
  - Wires the launcher into the repository workspace route.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
  - Adds Terminal mode state and the `External Termux` panel in the repository Terminal tab.
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`
  - Covers mode labels, target label, and status mapping.

---

### Task 1: Add Safe Termux SSH Command Builder

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt`
- Create: `android/app/src/test/java/dev/goblin/android/termux/TermuxCommandBuilderTest.kt`

- [ ] **Step 1: Write failing command builder tests**

Create `android/app/src/test/java/dev/goblin/android/termux/TermuxCommandBuilderTest.kt`:

```kotlin
package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TermuxCommandBuilderTest {
    @Test
    fun `ssh command targets selected workspace with interactive shell`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 2222,
                remotePath = "/srv/app",
            ),
        )

        assertEquals(
            "ssh -p 2222 'root@example.com' -t 'cd '\\''/srv/app'\\'' && exec \"\${SHELL:-sh}\" -l'",
            command,
        )
    }

    @Test
    fun `ssh command shell quotes paths with spaces and single quotes`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "deployer",
                host = "example.com",
                port = 22,
                remotePath = "/srv/app's worktree",
            ),
        )
        val expectedRemoteCommand = "cd '/srv/app'\\''s worktree' && exec \"\${SHELL:-sh}\" -l"

        assertEquals(
            "ssh -p 22 'deployer@example.com' -t ${TermuxCommandBuilder.shellQuote(expectedRemoteCommand)}",
            command,
        )
    }

    @Test
    fun `shell quote handles embedded single quotes`() {
        assertEquals("'plain'", TermuxCommandBuilder.shellQuote("plain"))
        assertEquals("'/srv/app'\\''s worktree'", TermuxCommandBuilder.shellQuote("/srv/app's worktree"))
    }

    @Test
    fun `remote target conversion preserves host port user and path`() {
        val target = RemoteTarget(
            id = "host-1",
            alias = "Dev",
            host = "example.com",
            user = "root",
            port = 2200,
            remotePath = "/srv/app",
            identityRefId = "identity-1",
        )

        assertEquals(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 2200,
                remotePath = "/srv/app",
            ),
            TermuxCommandBuilder.fromRemoteTarget(target),
        )
    }

    @Test
    fun `invalid targets are rejected before command construction`() {
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "", host = "example.com", port = 22, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "", port = 22, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "example.com", port = 0, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "example.com", port = 22, remotePath = "srv/app")
        }
    }

    @Test
    fun `command contains only ssh handoff primitives`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 22,
                remotePath = "/srv/app",
            ),
        )

        assertTrue(command.startsWith("ssh -p 22 "))
        assertTrue(command.contains(" -t "))
        assertTrue(command.contains("cd "))
        assertTrue(command.contains("exec \"\${SHELL:-sh}\" -l"))
    }
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.TermuxCommandBuilderTest"
```

Expected result: FAIL because `TermuxCommandBuilder` and `TermuxSshTarget` do not exist.

- [ ] **Step 3: Add the minimal command builder implementation**

Create `android/app/src/main/java/dev/goblin/android/termux/TermuxCommandBuilder.kt`:

```kotlin
package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile

data class TermuxSshTarget(
    val user: String,
    val host: String,
    val port: Int,
    val remotePath: String,
) {
    init {
        require(user.isNotBlank()) { "SSH user is required" }
        require(host.isNotBlank()) { "SSH host is required" }
        require(port in SshHostProfile.ValidPortRange) { "SSH port must be in 1..65535" }
        require(remotePath.trim().startsWith("/")) { "Remote path must be absolute" }
    }
}

object TermuxCommandBuilder {
    fun fromRemoteTarget(target: RemoteTarget): TermuxSshTarget =
        TermuxSshTarget(
            user = target.user.trim(),
            host = target.host.trim(),
            port = target.port,
            remotePath = target.remotePath.trim(),
        )

    fun sshWorkspaceCommand(target: TermuxSshTarget): String {
        val userAtHost = "${target.user.trim()}@${target.host.trim()}"
        val remoteCommand = "cd ${shellQuote(target.remotePath.trim())} && exec \"\${SHELL:-sh}\" -l"
        return "ssh -p ${target.port} ${shellQuote(userAtHost)} -t ${shellQuote(remoteCommand)}"
    }

    internal fun shellQuote(value: String): String {
        require(value.isNotEmpty()) { "Shell value is required" }
        return "'${value.replace("'", "'\\''")}'"
    }
}
```

- [ ] **Step 4: Run the command builder tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.TermuxCommandBuilderTest"
```

Expected result: PASS.

---

### Task 2: Add Manifest And Termux Contract Static Tests

**Files:**
- Create: `android/app/src/test/java/dev/goblin/android/termux/TermuxAndroidContractTest.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write failing static contract tests**

Create `android/app/src/test/java/dev/goblin/android/termux/TermuxAndroidContractTest.kt`:

```kotlin
package dev.goblin.android.termux

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TermuxAndroidContractTest {
    @Test
    fun `manifest declares termux run command permission`() {
        val manifest = androidManifestText()

        assertTrue(
            manifest.contains("""<uses-permission android:name="com.termux.permission.RUN_COMMAND" />"""),
        )
    }

    @Test
    fun `manifest declares termux package visibility`() {
        val manifest = androidManifestText()

        assertTrue(manifest.contains("""<package android:name="com.termux" />"""))
        assertTrue(manifest.contains("""<action android:name="com.termux.RUN_COMMAND" />"""))
    }

    @Test
    fun `hardcoded run command constants match official termux contract`() {
        assertEquals("com.termux", TermuxRunCommandContract.PackageName)
        assertEquals("com.termux.app.RunCommandService", TermuxRunCommandContract.RunCommandServiceName)
        assertEquals("com.termux.permission.RUN_COMMAND", TermuxRunCommandContract.PermissionRunCommand)
        assertEquals("com.termux.RUN_COMMAND", TermuxRunCommandContract.ActionRunCommand)
        assertEquals("com.termux.RUN_COMMAND_PATH", TermuxRunCommandContract.ExtraCommandPath)
        assertEquals("com.termux.RUN_COMMAND_ARGUMENTS", TermuxRunCommandContract.ExtraArguments)
        assertEquals("com.termux.RUN_COMMAND_WORKDIR", TermuxRunCommandContract.ExtraWorkdir)
        assertEquals("com.termux.RUN_COMMAND_BACKGROUND", TermuxRunCommandContract.ExtraBackground)
        assertEquals("com.termux.RUN_COMMAND_SESSION_ACTION", TermuxRunCommandContract.ExtraSessionAction)
        assertEquals("/data/data/com.termux/files/usr/bin/bash", TermuxRunCommandContract.BashPath)
        assertEquals("/data/data/com.termux/files/home", TermuxRunCommandContract.HomePath)
        assertEquals("0", TermuxRunCommandContract.SessionActionSwitchToNewSession)
    }

    private fun androidManifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
            File("android/app/src/main/AndroidManifest.xml"),
        )
        val manifest = candidates.firstOrNull { it.isFile }
            ?: error("AndroidManifest.xml not found from ${File(".").absolutePath}")
        return manifest.readText()
    }
}
```

- [ ] **Step 2: Run the static contract tests to verify they fail**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.TermuxAndroidContractTest"
```

Expected result: FAIL because `TermuxRunCommandContract` does not exist and the Manifest does not declare the Termux contract.

- [ ] **Step 3: Add Termux Manifest declarations**

Modify `android/app/src/main/AndroidManifest.xml` so the top of the file is:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="com.termux.permission.RUN_COMMAND" />

    <queries>
        <package android:name="com.termux" />
        <intent>
            <action android:name="com.termux.RUN_COMMAND" />
        </intent>
    </queries>

    <application
```

Leave the existing `<application>` body unchanged.

- [ ] **Step 4: Add the Termux contract constants**

Create the contract object at the top of `android/app/src/main/java/dev/goblin/android/termux/AndroidExternalTermuxEnvironment.kt`; the Android environment class will be added in Task 4:

```kotlin
package dev.goblin.android.termux

internal object TermuxRunCommandContract {
    const val PackageName = "com.termux"
    const val RunCommandServiceName = "com.termux.app.RunCommandService"
    const val PermissionRunCommand = "com.termux.permission.RUN_COMMAND"
    const val ActionRunCommand = "com.termux.RUN_COMMAND"
    const val ExtraCommandPath = "com.termux.RUN_COMMAND_PATH"
    const val ExtraArguments = "com.termux.RUN_COMMAND_ARGUMENTS"
    const val ExtraWorkdir = "com.termux.RUN_COMMAND_WORKDIR"
    const val ExtraBackground = "com.termux.RUN_COMMAND_BACKGROUND"
    const val ExtraSessionAction = "com.termux.RUN_COMMAND_SESSION_ACTION"
    const val ExtraCommandLabel = "com.termux.RUN_COMMAND_COMMAND_LABEL"
    const val ExtraCommandDescription = "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION"
    const val BashPath = "/data/data/com.termux/files/usr/bin/bash"
    const val HomePath = "/data/data/com.termux/files/home"
    const val SessionActionSwitchToNewSession = "0"
}
```

- [ ] **Step 5: Run the static contract tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.TermuxAndroidContractTest"
```

Expected result: PASS.

---

### Task 3: Add Pure External Termux Launch Policy

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/termux/ExternalTermuxLauncher.kt`
- Create: `android/app/src/test/java/dev/goblin/android/termux/ExternalTermuxLauncherTest.kt`

- [ ] **Step 1: Write failing launcher policy tests**

Create `android/app/src/test/java/dev/goblin/android/termux/ExternalTermuxLauncherTest.kt`:

```kotlin
package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalTermuxLauncherTest {
    @Test
    fun `direct run command launch is preferred when available`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = true,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(target())

        assertEquals(ExternalTermuxLaunchResult.Launched, result)
        assertEquals(listOf(expectedCommand()), environment.launchedCommands)
        assertTrue(environment.copiedCommands.isEmpty())
        assertFalse(environment.openedTermux)
    }

    @Test
    fun `missing termux copies command and reports unavailable`() {
        val environment = FakeExternalTermuxEnvironment(termuxInstalled = false)
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(target())

        assertEquals(ExternalTermuxLaunchResult.Unavailable(copiedCommand = true), result)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.launchedCommands.isEmpty())
        assertFalse(environment.openedTermux)
    }

    @Test
    fun `missing run command permission falls back to copy and open app`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = false,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(target())

        assertEquals(ExternalTermuxLaunchResult.CopiedFallback(openedTermux = true), result)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.openedTermux)
        assertTrue(environment.launchedCommands.isEmpty())
    }

    @Test
    fun `direct launch failure falls back to copy and open app`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = true,
            directLaunchSucceeds = false,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(target())

        assertEquals(ExternalTermuxLaunchResult.CopiedFallback(openedTermux = true), result)
        assertEquals(listOf(expectedCommand()), environment.launchedCommands)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.openedTermux)
    }

    @Test
    fun `fallback failure returns failed result`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = false,
            copySucceeds = false,
            openTermuxSucceeds = false,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(target())

        assertEquals(
            ExternalTermuxLaunchResult.Failed(
                copiedCommand = false,
                openedTermux = false,
                message = "Termux command API unavailable",
            ),
            result,
        )
    }

    @Test
    fun `copy command only does not open or launch termux`() {
        val environment = FakeExternalTermuxEnvironment(termuxInstalled = true)
        val launcher = ExternalTermuxLauncher(environment)

        val copied = launcher.copyCommand(target())

        assertTrue(copied)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.launchedCommands.isEmpty())
        assertFalse(environment.openedTermux)
    }

    private fun target(): RemoteTarget = RemoteTarget(
        id = "host-1",
        alias = "Dev",
        host = "example.com",
        user = "root",
        port = 22,
        remotePath = "/srv/app",
        identityRefId = "identity-1",
    )

    private fun expectedCommand(): String =
        "ssh -p 22 'root@example.com' -t 'cd '\\''/srv/app'\\'' && exec \"\${SHELL:-sh}\" -l'"

    private class FakeExternalTermuxEnvironment(
        private val termuxInstalled: Boolean = true,
        private val directRunCommandAvailable: Boolean = false,
        private val directLaunchSucceeds: Boolean = true,
        private val copySucceeds: Boolean = true,
        private val openTermuxSucceeds: Boolean = true,
    ) : ExternalTermuxEnvironment {
        val launchedCommands = mutableListOf<String>()
        val copiedCommands = mutableListOf<String>()
        var openedTermux = false

        override fun isTermuxInstalled(): Boolean = termuxInstalled

        override fun canRunCommandDirectly(): Boolean = directRunCommandAvailable

        override fun launchRunCommand(command: String): Boolean {
            launchedCommands += command
            return directLaunchSucceeds
        }

        override fun copyCommand(command: String): Boolean {
            copiedCommands += command
            return copySucceeds
        }

        override fun openTermux(): Boolean {
            openedTermux = true
            return openTermuxSucceeds
        }
    }
}
```

- [ ] **Step 2: Run launcher tests to verify they fail**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.ExternalTermuxLauncherTest"
```

Expected result: FAIL because `ExternalTermuxLauncher`, `ExternalTermuxEnvironment`, and `ExternalTermuxLaunchResult` do not exist.

- [ ] **Step 3: Add the pure launcher policy**

Create `android/app/src/main/java/dev/goblin/android/termux/ExternalTermuxLauncher.kt`:

```kotlin
package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget

interface ExternalTermuxEnvironment {
    fun isTermuxInstalled(): Boolean
    fun canRunCommandDirectly(): Boolean
    fun launchRunCommand(command: String): Boolean
    fun copyCommand(command: String): Boolean
    fun openTermux(): Boolean
}

sealed interface ExternalTermuxLaunchResult {
    data object Launched : ExternalTermuxLaunchResult
    data class CopiedFallback(val openedTermux: Boolean) : ExternalTermuxLaunchResult
    data class Unavailable(val copiedCommand: Boolean) : ExternalTermuxLaunchResult
    data class Failed(
        val copiedCommand: Boolean,
        val openedTermux: Boolean,
        val message: String,
    ) : ExternalTermuxLaunchResult
}

class ExternalTermuxLauncher(
    private val environment: ExternalTermuxEnvironment,
) {
    fun openInTermux(target: RemoteTarget): ExternalTermuxLaunchResult {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(TermuxCommandBuilder.fromRemoteTarget(target))
        if (!environment.isTermuxInstalled()) {
            return ExternalTermuxLaunchResult.Unavailable(copiedCommand = environment.copyCommand(command))
        }

        if (environment.canRunCommandDirectly() && environment.launchRunCommand(command)) {
            return ExternalTermuxLaunchResult.Launched
        }

        val copied = environment.copyCommand(command)
        val opened = environment.openTermux()
        if (copied || opened) {
            return ExternalTermuxLaunchResult.CopiedFallback(openedTermux = opened)
        }

        return ExternalTermuxLaunchResult.Failed(
            copiedCommand = false,
            openedTermux = false,
            message = "Termux command API unavailable",
        )
    }

    fun copyCommand(target: RemoteTarget): Boolean {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(TermuxCommandBuilder.fromRemoteTarget(target))
        return environment.copyCommand(command)
    }
}
```

- [ ] **Step 4: Run launcher tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.ExternalTermuxLauncherTest"
```

Expected result: PASS.

---

### Task 4: Add Android Termux Environment Adapter

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/termux/AndroidExternalTermuxEnvironment.kt`
- Test: `android/app/src/test/java/dev/goblin/android/termux/TermuxAndroidContractTest.kt`

- [ ] **Step 1: Extend contract tests for the Android command label extras**

Modify `TermuxAndroidContractTest.kt` and add these assertions to `hardcoded run command constants match official termux contract`:

```kotlin
        assertEquals("com.termux.RUN_COMMAND_COMMAND_LABEL", TermuxRunCommandContract.ExtraCommandLabel)
        assertEquals("com.termux.RUN_COMMAND_COMMAND_DESCRIPTION", TermuxRunCommandContract.ExtraCommandDescription)
```

- [ ] **Step 2: Add Android adapter imports and implementation**

Replace `android/app/src/main/java/dev/goblin/android/termux/AndroidExternalTermuxEnvironment.kt` with:

```kotlin
package dev.goblin.android.termux

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

internal object TermuxRunCommandContract {
    const val PackageName = "com.termux"
    const val RunCommandServiceName = "com.termux.app.RunCommandService"
    const val PermissionRunCommand = "com.termux.permission.RUN_COMMAND"
    const val ActionRunCommand = "com.termux.RUN_COMMAND"
    const val ExtraCommandPath = "com.termux.RUN_COMMAND_PATH"
    const val ExtraArguments = "com.termux.RUN_COMMAND_ARGUMENTS"
    const val ExtraWorkdir = "com.termux.RUN_COMMAND_WORKDIR"
    const val ExtraBackground = "com.termux.RUN_COMMAND_BACKGROUND"
    const val ExtraSessionAction = "com.termux.RUN_COMMAND_SESSION_ACTION"
    const val ExtraCommandLabel = "com.termux.RUN_COMMAND_COMMAND_LABEL"
    const val ExtraCommandDescription = "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION"
    const val BashPath = "/data/data/com.termux/files/usr/bin/bash"
    const val HomePath = "/data/data/com.termux/files/home"
    const val SessionActionSwitchToNewSession = "0"
}

class AndroidExternalTermuxEnvironment(
    context: Context,
) : ExternalTermuxEnvironment {
    private val appContext = context.applicationContext

    override fun isTermuxInstalled(): Boolean =
        packageManager().getLaunchIntentForPackage(TermuxRunCommandContract.PackageName) != null ||
            runCatching {
                packageManager().getPackageInfo(TermuxRunCommandContract.PackageName, 0)
            }.isSuccess

    override fun canRunCommandDirectly(): Boolean =
        isTermuxInstalled() &&
            ContextCompat.checkSelfPermission(
                appContext,
                TermuxRunCommandContract.PermissionRunCommand,
            ) == PackageManager.PERMISSION_GRANTED

    override fun launchRunCommand(command: String): Boolean =
        runCatching {
            val intent = Intent(TermuxRunCommandContract.ActionRunCommand)
                .setClassName(
                    TermuxRunCommandContract.PackageName,
                    TermuxRunCommandContract.RunCommandServiceName,
                )
                .putExtra(TermuxRunCommandContract.ExtraCommandPath, TermuxRunCommandContract.BashPath)
                .putExtra(TermuxRunCommandContract.ExtraArguments, arrayOf("-lc", command))
                .putExtra(TermuxRunCommandContract.ExtraWorkdir, TermuxRunCommandContract.HomePath)
                .putExtra(TermuxRunCommandContract.ExtraBackground, false)
                .putExtra(
                    TermuxRunCommandContract.ExtraSessionAction,
                    TermuxRunCommandContract.SessionActionSwitchToNewSession,
                )
                .putExtra(TermuxRunCommandContract.ExtraCommandLabel, "Goblin workspace SSH")
                .putExtra(
                    TermuxRunCommandContract.ExtraCommandDescription,
                    "Open the selected Goblin workspace over SSH.",
                )
            appContext.startService(intent) != null
        }.getOrDefault(false)

    override fun copyCommand(command: String): Boolean =
        runCatching {
            val clipboard = ContextCompat.getSystemService(appContext, ClipboardManager::class.java)
                ?: return false
            clipboard.setPrimaryClip(ClipData.newPlainText("Goblin Termux SSH command", command))
            true
        }.getOrDefault(false)

    override fun openTermux(): Boolean =
        runCatching {
            val intent = packageManager().getLaunchIntentForPackage(TermuxRunCommandContract.PackageName)
                ?: return false
            appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }.getOrDefault(false)

    private fun packageManager(): PackageManager = appContext.packageManager
}
```

- [ ] **Step 3: Run contract and launcher tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.*"
```

Expected result: PASS.

- [ ] **Step 4: Compile Android source**

Run from `android/`:

```bash
./gradlew ":app:compileDebugKotlin"
```

Expected result: PASS.

---

### Task 5: Add Repository Terminal Mode State

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/repositories/RepositorySetupStateTest.kt`

- [ ] **Step 1: Write failing repository state tests**

Add these tests to `RepositorySetupStateTest.kt`:

```kotlin
    @Test
    fun `terminal modes expose remote ssh and external termux`() {
        assertEquals(
            listOf("Remote SSH", "External Termux"),
            repositoryTerminalModes().map { it.label },
        )
    }

    @Test
    fun `external termux target label uses ssh authority`() {
        assertEquals(
            "root@example.com:2222",
            externalTermuxTargetLabel(host(id = "host-1", identityRefId = "identity-1").copy(port = 2222)),
        )
    }

    @Test
    fun `external termux launch results map to stable status labels`() {
        assertEquals("ready", externalTermuxStatusLabel(ExternalTermuxStatus.Ready))
        assertEquals("command copied", externalTermuxStatusLabel(ExternalTermuxStatus.CommandCopied))
        assertEquals(
            "opened in Termux",
            externalTermuxStatusLabel(
                externalTermuxStatusAfterLaunch(ExternalTermuxLaunchResult.Launched),
            ),
        )
        assertEquals(
            "Termux not installed",
            externalTermuxStatusLabel(
                externalTermuxStatusAfterLaunch(ExternalTermuxLaunchResult.Unavailable(copiedCommand = true)),
            ),
        )
        assertEquals(
            "Termux command API unavailable",
            externalTermuxStatusLabel(
                externalTermuxStatusAfterLaunch(ExternalTermuxLaunchResult.CopiedFallback(openedTermux = true)),
            ),
        )
        assertEquals(
            "failed",
            externalTermuxStatusLabel(
                externalTermuxStatusAfterLaunch(
                    ExternalTermuxLaunchResult.Failed(
                        copiedCommand = false,
                        openedTermux = false,
                        message = "Termux command API unavailable",
                    ),
                ),
            ),
        )
    }
```

Add this import to the same test file:

```kotlin
import dev.goblin.android.termux.ExternalTermuxLaunchResult
```

- [ ] **Step 2: Run state tests to verify they fail**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: FAIL because the mode/status helpers do not exist.

- [ ] **Step 3: Add terminal mode and status helpers**

In `RepositorySetupScreen.kt`, add this import:

```kotlin
import dev.goblin.android.termux.ExternalTermuxLaunchResult
```

Add these declarations near `RepositoryWorkspaceTab`:

```kotlin
internal enum class RepositoryTerminalMode(val label: String) {
    RemoteSsh("Remote SSH"),
    ExternalTermux("External Termux"),
}

internal enum class ExternalTermuxStatus(val label: String) {
    Ready("ready"),
    CommandCopied("command copied"),
    OpenedInTermux("opened in Termux"),
    TermuxNotInstalled("Termux not installed"),
    CommandApiUnavailable("Termux command API unavailable"),
    Failed("failed"),
}

internal fun repositoryTerminalModes(): List<RepositoryTerminalMode> =
    RepositoryTerminalMode.entries.toList()

internal fun externalTermuxTargetLabel(host: SshHostProfile): String =
    "${host.user}@${host.host}:${host.port}"

internal fun externalTermuxStatusLabel(status: ExternalTermuxStatus): String =
    status.label

internal fun externalTermuxStatusAfterLaunch(result: ExternalTermuxLaunchResult): ExternalTermuxStatus =
    when (result) {
        ExternalTermuxLaunchResult.Launched -> ExternalTermuxStatus.OpenedInTermux
        is ExternalTermuxLaunchResult.CopiedFallback -> ExternalTermuxStatus.CommandApiUnavailable
        is ExternalTermuxLaunchResult.Unavailable -> ExternalTermuxStatus.TermuxNotInstalled
        is ExternalTermuxLaunchResult.Failed -> ExternalTermuxStatus.Failed
    }
```

- [ ] **Step 4: Run repository state tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: PASS.

---

### Task 6: Wire External Termux Into Repository Terminal UI

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`

- [ ] **Step 1: Add UI imports**

Add these imports to `RepositorySetupScreen.kt`:

```kotlin
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import dev.goblin.android.termux.ExternalTermuxLaunchResult
```

If `ExternalTermuxLaunchResult` was already imported in Task 5, keep a single import.

- [ ] **Step 2: Extend `RepositoryWorkspaceScreen` callbacks**

Modify the `RepositoryWorkspaceScreen` parameter list:

```kotlin
    onCreateTerminalAtPath: (String) -> TerminalSessionRecord = {
        throw UnsupportedOperationException("Terminal sessions are not available")
    },
    onOpenExternalTermuxAtPath: (RemoteTarget) -> ExternalTermuxLaunchResult = {
        ExternalTermuxLaunchResult.Unavailable(copiedCommand = false)
    },
    onCopyExternalTermuxCommandAtPath: (RemoteTarget) -> Boolean = { false },
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit = {},
```

- [ ] **Step 3: Add workspace-level external Termux actions**

Inside `RepositoryWorkspaceScreen`, below `createTerminal(path: String)`, add:

```kotlin
    fun openExternalTermux(path: String, onResult: (ExternalTermuxLaunchResult) -> Unit) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    onOpenExternalTermuxAtPath(RemoteTarget.fromHostProfile(host, path))
                }
            }.onSuccess { result ->
                onResult(result)
            }.onFailure {
                actionError = it.message ?: "External Termux launch failed"
                onResult(
                    ExternalTermuxLaunchResult.Failed(
                        copiedCommand = false,
                        openedTermux = false,
                        message = it.message ?: "External Termux launch failed",
                    ),
                )
            }
        }
    }

    fun copyExternalTermuxCommand(path: String, onCopied: (Boolean) -> Unit) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    onCopyExternalTermuxCommandAtPath(RemoteTarget.fromHostProfile(host, path))
                }
            }.onSuccess { copied ->
                onCopied(copied)
                if (!copied) actionError = "External Termux command copy failed"
            }.onFailure {
                actionError = it.message ?: "External Termux command copy failed"
                onCopied(false)
            }
        }
    }
```

- [ ] **Step 4: Pass callbacks to `RepositoryTerminalPanel`**

Update the `RepositoryTerminalPanel(...)` call in `RepositoryWorkspaceScreen`:

```kotlin
                RepositoryWorkspaceTab.Terminal -> RepositoryTerminalPanel(
                    host = host,
                    hostProfileId = repository.hostProfileId,
                    targetHostId = RemoteTarget.fromHostProfile(host, selectedTerminalWorkspacePath).id,
                    path = selectedTerminalWorkspacePath,
                    workspaceOptions = terminalWorkspaceOptions,
                    sessions = terminalSessions,
                    onSelectWorkspace = ::selectTerminalWorkspace,
                    onCreateTerminalAtPath = ::createTerminal,
                    onOpenExternalTermuxAtPath = ::openExternalTermux,
                    onCopyExternalTermuxCommandAtPath = ::copyExternalTermuxCommand,
                    onOpenTerminalSession = onOpenTerminalSession,
                    onDeleteTerminalSession = ::requestDeleteTerminalSession,
                )
```

- [ ] **Step 5: Extend `RepositoryTerminalPanel` signature and mode state**

Change the `RepositoryTerminalPanel` signature to:

```kotlin
private fun RepositoryTerminalPanel(
    host: SshHostProfile,
    hostProfileId: String,
    targetHostId: String,
    path: String,
    workspaceOptions: List<TerminalWorkspaceOption>,
    sessions: List<TerminalSessionRecord>,
    onSelectWorkspace: (String) -> Unit,
    onCreateTerminalAtPath: (String) -> Unit,
    onOpenExternalTermuxAtPath: (String, (ExternalTermuxLaunchResult) -> Unit) -> Unit,
    onCopyExternalTermuxCommandAtPath: (String, (Boolean) -> Unit) -> Unit,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
)
```

Inside the function, add this state near `workspaceMenuExpanded`:

```kotlin
    var selectedMode by remember(path) { mutableStateOf(RepositoryTerminalMode.RemoteSsh) }
    var externalTermuxStatus by remember(path) { mutableStateOf(ExternalTermuxStatus.Ready) }
```

- [ ] **Step 6: Add the mode selector composable**

Add this composable below `RepositoryTerminalPanel`:

```kotlin
@Composable
private fun RepositoryTerminalModeSelector(
    selectedMode: RepositoryTerminalMode,
    onSelectMode: (RepositoryTerminalMode) -> Unit,
) {
    val modes = repositoryTerminalModes()
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        modes.forEachIndexed { index, mode ->
            SegmentedButton(
                selected = selectedMode == mode,
                onClick = { onSelectMode(mode) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = modes.size),
            ) {
                Text(mode.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
```

- [ ] **Step 7: Add the external Termux panel composable**

Add this composable below `RepositoryTerminalModeSelector`:

```kotlin
@Composable
private fun ExternalTermuxPanel(
    host: SshHostProfile,
    path: String,
    status: ExternalTermuxStatus,
    onOpenExternalTermuxAtPath: (String, (ExternalTermuxLaunchResult) -> Unit) -> Unit,
    onCopyExternalTermuxCommandAtPath: (String, (Boolean) -> Unit) -> Unit,
    onStatusChange: (ExternalTermuxStatus) -> Unit,
) {
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
                    Text(externalTermuxTargetLabel(host), style = MaterialTheme.typography.titleMedium)
                    Text(
                        path,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    externalTermuxStatusLabel(status),
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
                    onClick = {
                        onCopyExternalTermuxCommandAtPath(path) { copied ->
                            onStatusChange(
                                if (copied) ExternalTermuxStatus.CommandCopied else ExternalTermuxStatus.Failed,
                            )
                        }
                    },
                ) {
                    Text("Copy command", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        onOpenExternalTermuxAtPath(path) { result ->
                            onStatusChange(externalTermuxStatusAfterLaunch(result))
                        }
                    },
                ) {
                    Text("Open in Termux", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
```

- [ ] **Step 8: Switch the terminal panel body by selected mode**

In `RepositoryTerminalPanel`, add `RepositoryTerminalModeSelector(...)` as the first child of the outer `Column`:

```kotlin
        RepositoryTerminalModeSelector(
            selectedMode = selectedMode,
            onSelectMode = {
                selectedMode = it
                externalTermuxStatus = ExternalTermuxStatus.Ready
            },
        )
```

Then wrap the existing current workspace card and session list in this branch:

```kotlin
        when (selectedMode) {
            RepositoryTerminalMode.RemoteSsh -> RemoteSshTerminalPanelContent(
                selectedWorkspaceOption = selectedWorkspaceOption,
                workspaceOptions = workspaceOptions,
                workspaceSessionCounts = workspaceSessionCounts,
                workspaceSessions = workspaceSessions,
                openedOrderLabels = openedOrderLabels,
                activeWorktreeCount = activeWorktreeCount,
                workspaceMenuExpanded = workspaceMenuExpanded,
                onWorkspaceMenuExpandedChange = { workspaceMenuExpanded = it },
                onSelectWorkspace = onSelectWorkspace,
                onCreateTerminalAtPath = onCreateTerminalAtPath,
                onOpenTerminalSession = onOpenTerminalSession,
                onDeleteTerminalSession = onDeleteTerminalSession,
            )
            RepositoryTerminalMode.ExternalTermux -> ExternalTermuxPanel(
                host = host,
                path = path,
                status = externalTermuxStatus,
                onOpenExternalTermuxAtPath = onOpenExternalTermuxAtPath,
                onCopyExternalTermuxCommandAtPath = onCopyExternalTermuxCommandAtPath,
                onStatusChange = { externalTermuxStatus = it },
            )
        }
```

Add this helper below `ExternalTermuxPanel`. Its body is the current Remote SSH card, workspace menu, and session list moved out of `RepositoryTerminalPanel` without behavior changes:

```kotlin
@Composable
private fun RemoteSshTerminalPanelContent(
    selectedWorkspaceOption: TerminalWorkspaceOption,
    workspaceOptions: List<TerminalWorkspaceOption>,
    workspaceSessionCounts: List<Pair<String, Int>>,
    workspaceSessions: List<TerminalSessionRecord>,
    openedOrderLabels: Map<String, String>,
    activeWorktreeCount: Int,
    workspaceMenuExpanded: Boolean,
    onWorkspaceMenuExpandedChange: (Boolean) -> Unit,
    onSelectWorkspace: (String) -> Unit,
    onCreateTerminalAtPath: (String) -> Unit,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
) {
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
                    onClick = { onWorkspaceMenuExpandedChange(true) },
                ) {
                    Text(
                        "Switch workspace",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Button(onClick = { onCreateTerminalAtPath(selectedWorkspaceOption.path) }) {
                    Text("New terminal", maxLines = 1)
                }
            }
            DropdownMenu(
                expanded = workspaceMenuExpanded,
                onDismissRequest = { onWorkspaceMenuExpandedChange(false) },
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
                            onWorkspaceMenuExpandedChange(false)
                            onSelectWorkspace(option.path)
                        },
                    )
                }
            }
        }
    }
    if (workspaceSessions.isEmpty()) {
        Text("No terminals for this worktree.")
    } else {
        Column(
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
        ) {
            workspaceSessions.forEach { session ->
                val label = openedOrderLabels[session.id] ?: terminalSessionDefaultLabel(0)
                SwipeDeleteTerminalSessionRow(
                    onDelete = { onDeleteTerminalSession(session, label) },
                ) {
                    TerminalSessionRow(
                        session = session,
                        label = label,
                        onOpenTerminalSession = onOpenTerminalSession,
                        onDeleteTerminalSession = onDeleteTerminalSession,
                    )
                }
            }
        }
    }
}
```

- [ ] **Step 9: Compile repository UI**

Run from `android/`:

```bash
./gradlew ":app:compileDebugKotlin"
```

Expected result: PASS.

---

### Task 7: Wire Launcher From Activity To App Route

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/MainActivity.kt`
- Modify: `android/app/src/main/java/dev/goblin/android/GoblinAndroidApp.kt`

- [ ] **Step 1: Add imports and constructor parameter in app root**

In `GoblinAndroidApp.kt`, add imports:

```kotlin
import dev.goblin.android.termux.ExternalTermuxLauncher
import dev.goblin.android.termux.ExternalTermuxLaunchResult
```

Add this parameter to `GoblinAndroidApp(...)`:

```kotlin
    externalTermuxLauncher: ExternalTermuxLauncher,
```

- [ ] **Step 2: Pass launcher callbacks to repository screen**

Inside the `RepositoryWorkspaceScreen(...)` call in `GoblinAndroidApp.kt`, add:

```kotlin
                    onOpenExternalTermuxAtPath = { target ->
                        externalTermuxLauncher.openInTermux(target)
                    },
                    onCopyExternalTermuxCommandAtPath = { target ->
                        externalTermuxLauncher.copyCommand(target)
                    },
```

Place these callbacks after `onCreateTerminalAtPath` and before `onOpenTerminalSession`.

- [ ] **Step 3: Instantiate launcher in `MainActivity`**

In `MainActivity.kt`, add imports:

```kotlin
import dev.goblin.android.termux.AndroidExternalTermuxEnvironment
import dev.goblin.android.termux.ExternalTermuxLauncher
```

After `terminalForegroundBridge` is created, add:

```kotlin
        val externalTermuxLauncher = ExternalTermuxLauncher(
            AndroidExternalTermuxEnvironment(this),
        )
```

Pass it to `GoblinAndroidApp(...)`:

```kotlin
                    externalTermuxLauncher = externalTermuxLauncher,
```

- [ ] **Step 4: Compile app wiring**

Run from `android/`:

```bash
./gradlew ":app:compileDebugKotlin"
```

Expected result: PASS.

---

### Task 8: Verify The Full Phase

**Files:**
- All files touched in Tasks 1-7.

- [ ] **Step 1: Run focused tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.termux.*" --tests "dev.goblin.android.ui.screens.repositories.RepositorySetupStateTest"
```

Expected result: PASS.

- [ ] **Step 2: Run Android unit tests and assemble debug APK**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" ":app:assembleDebug"
```

Expected result: PASS.

- [ ] **Step 3: Manual device smoke test**

Install the debug APK on a device or emulator with Termux installed. In Termux, ensure `~/.termux/termux.properties` contains:

```properties
allow-external-apps=true
```

From Android Settings, grant Goblin the `Run commands in Termux environment` permission if the permission appears under additional permissions. Open a Goblin repository, go to the Terminal tab, select `External Termux`, and tap `Open in Termux`.

Expected result when permission and Termux property are configured: Termux opens a foreground session running:

```bash
ssh -p <port> '<user>@<host>' -t 'cd '\''<remote-path>'\'' && exec "${SHELL:-sh}" -l'
```

Expected result when direct command execution is not available: Goblin copies the SSH command, opens Termux when possible, and shows `Termux command API unavailable`.

Expected result when Termux is not installed: Goblin copies the SSH command when clipboard is available and shows `Termux not installed`.

- [ ] **Step 4: Confirm session records remain unchanged**

Before tapping `Open in Termux`, note the number of Goblin terminal sessions shown in the Terminal tab under `Remote SSH`. Tap `Open in Termux`, return to Goblin, and switch back to `Remote SSH`.

Expected result: the session count is unchanged because external Termux sessions are owned by Termux, not Goblin.

---

## Self-Review

Spec coverage:

- `External Termux` mode in repository Terminal tab: Task 5 and Task 6.
- Safe SSH command for host, port, user, path: Task 1.
- Prefer direct Termux command execution: Task 3 and Task 4.
- Copy/open fallback: Task 3, Task 4, Task 6.
- Status labels: Task 5 and Task 6.
- No Goblin terminal records for external Termux: Task 3 policy and Task 8 manual verification.
- No private key export: no task reads `SecureIdentityStore` or identity material.
- Termux permission and package visibility: Task 2.
- Official `RUN_COMMAND` contract documented: Scope section and Task 2 constants.

Intentional gaps:

- Embedded local runtime is a separate subsystem and needs its own implementation plan.
- Release packaging and license gate work is outside this functional handoff phase.

Concrete-step scan:

- The plan contains concrete file paths, commands, expected results, Kotlin snippets, Manifest snippets, and manual verification expectations.
- Each Phase 1 task has named files, explicit code, verification commands, and expected outcomes.

Type consistency:

- `ExternalTermuxLaunchResult`, `ExternalTermuxEnvironment`, and `ExternalTermuxLauncher` are defined in Task 3 before use in UI and app wiring.
- `TermuxRunCommandContract` is defined in Task 2 before Android adapter implementation in Task 4.
- `RepositoryTerminalMode` and `ExternalTermuxStatus` are defined in Task 5 before use in Task 6.
