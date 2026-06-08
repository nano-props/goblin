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
        assertEquals(listOf(LaunchedCommand(command = expectedCommand(), stdin = null)), environment.launchedCommands)
        assertTrue(environment.copiedCommands.isEmpty())
        assertFalse(environment.openedTermux)
    }

    @Test
    fun `direct run command receives private key through stdin when available`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = true,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(
            ExternalTermuxLaunchRequest(
                target = target(),
                privateKeyBytes = privateKeyBytes(),
            ),
        )

        assertEquals(ExternalTermuxLaunchResult.Launched, result)
        assertEquals(
            listOf(
                LaunchedCommand(
                    command = TermuxCommandBuilder.sshWorkspaceCommandWithStdinPrivateKey(
                        TermuxCommandBuilder.fromRemoteTarget(target()),
                    ),
                    stdin = privateKeyText(),
                ),
            ),
            environment.launchedCommands,
        )
        assertTrue(environment.copiedCommands.isEmpty())
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
        assertEquals(listOf(LaunchedCommand(command = expectedCommand(), stdin = null)), environment.launchedCommands)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.openedTermux)
    }

    @Test
    fun `private key launch falls back to copying command when direct command is unavailable`() {
        val environment = FakeExternalTermuxEnvironment(
            termuxInstalled = true,
            directRunCommandAvailable = false,
        )
        val launcher = ExternalTermuxLauncher(environment)

        val result = launcher.openInTermux(
            ExternalTermuxLaunchRequest(
                target = target(),
                privateKeyBytes = privateKeyBytes(),
            ),
        )

        assertEquals(ExternalTermuxLaunchResult.CopiedFallback(openedTermux = true), result)
        assertEquals(listOf(expectedCommand()), environment.copiedCommands)
        assertTrue(environment.launchedCommands.isEmpty())
        assertTrue(environment.openedTermux)
        assertFalse(environment.copiedCommands.any { it.contains("PRIVATE KEY") })
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

    @Test
    fun `launch request loads private key when target has identity`() {
        val request = externalTermuxLaunchRequest(target()) { identityId ->
            assertEquals("identity-1", identityId)
            privateKeyBytes()
        }

        assertEquals(target(), request.target)
        assertEquals(privateKeyText(), request.privateKeyBytes?.toString(Charsets.UTF_8))
    }

    @Test
    fun `launch request does not load private key without identity`() {
        val request = externalTermuxLaunchRequest(target(identityRefId = null)) {
            error("Identity loader should not be called")
        }

        assertEquals(target(identityRefId = null), request.target)
        assertEquals(null, request.privateKeyBytes)
    }

    private fun target(identityRefId: String? = "identity-1"): RemoteTarget = RemoteTarget(
        id = "host-1",
        alias = "Dev",
        host = "example.com",
        user = "root",
        port = 22,
        remotePath = "/srv/app",
        identityRefId = identityRefId,
    )

    private fun expectedCommand(): String =
        "ssh -p 22 'root@example.com' -t 'cd '\\''/srv/app'\\'' && exec \"\${SHELL:-sh}\"'"

    private fun privateKeyText(): String =
        "-----BEGIN OPENSSH PRIVATE KEY-----\nkey-body\n-----END OPENSSH PRIVATE KEY-----\n"

    private fun privateKeyBytes(): ByteArray =
        privateKeyText().toByteArray(Charsets.UTF_8)

    private data class LaunchedCommand(
        val command: String,
        val stdin: String?,
    )

    private class FakeExternalTermuxEnvironment(
        private val termuxInstalled: Boolean = true,
        private val directRunCommandAvailable: Boolean = false,
        private val directLaunchSucceeds: Boolean = true,
        private val copySucceeds: Boolean = true,
        private val openTermuxSucceeds: Boolean = true,
    ) : ExternalTermuxEnvironment {
        val launchedCommands = mutableListOf<LaunchedCommand>()
        val copiedCommands = mutableListOf<String>()
        var openedTermux = false

        override fun isTermuxInstalled(): Boolean = termuxInstalled

        override fun canRunCommandDirectly(): Boolean = directRunCommandAvailable

        override fun launchRunCommand(command: String, stdin: String?): Boolean {
            launchedCommands += LaunchedCommand(command = command, stdin = stdin)
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
