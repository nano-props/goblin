package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustPolicy
import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteWorktreeServiceTest {
    @Test
    fun `create worktree is blocked until host key is trusted`() {
        val service = RemoteWorktreeService(
            client = FakeSshClient(),
            hostKeyStore = FakeHostKeyTrustStore(null),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.createWorktree(target(), branch = "feature/android", worktreePath = "/srv/app-feature")
        }

        assertEquals("Trust this host key before changing remote worktrees.", error.message)
    }

    @Test
    fun `create worktree runs quoted git worktree add command`() {
        val client = FakeSshClient()
        val service = RemoteWorktreeService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        service.createWorktree(target(), branch = "feature/android", worktreePath = "/srv/app-feature")

        assertTrue(client.lastScript.contains("git -C '/srv/app' worktree add '/srv/app-feature' 'feature/android'"))
    }

    @Test
    fun `allowed clean linked worktree removal runs quoted git worktree remove command`() {
        val client = FakeSshClient()
        val service = RemoteWorktreeService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        service.removeWorktree(target(), safeWorktree())

        assertTrue(client.lastScript.contains("git -C '/srv/app' worktree remove '/srv/app-feature'"))
    }

    @Test
    fun `blocked worktree removal does not run remote command`() {
        val client = FakeSshClient()
        val service = RemoteWorktreeService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.removeWorktree(target(), safeWorktree().copy(isDirty = true, changeCount = 2))
        }

        assertEquals("Dirty worktree cannot be removed.", error.message)
        assertEquals("", client.lastScript)
    }

    @Test
    fun `removal safety blocks unsafe worktrees`() {
        assertEquals("Primary worktree cannot be removed.", evaluateWorktreeRemoval(safeWorktree().copy(isPrimary = true)).reason)
        assertEquals("Dirty worktree cannot be removed.", evaluateWorktreeRemoval(safeWorktree().copy(isDirty = true, changeCount = 1)).reason)
        assertEquals("Locked worktree cannot be removed.", evaluateWorktreeRemoval(safeWorktree().copy(isLocked = true)).reason)
        assertEquals("Missing worktree cleanup is not supported here.", evaluateWorktreeRemoval(safeWorktree().copy(isMissing = true)).reason)
        assertEquals("Protected branch worktree cannot be removed.", evaluateWorktreeRemoval(safeWorktree().copy(branch = "main")).reason)
        assertTrue(evaluateWorktreeRemoval(safeWorktree()).allowed)
    }

    @Test
    fun `remove confirmation says remote server worktree is removed`() {
        val text = worktreeRemovalConfirmationText(safeWorktree())

        assertTrue(text.contains("remote worktree"))
        assertTrue(text.contains("SSH server"))
        assertTrue(text.contains("/srv/app-feature"))
    }

    private fun target(): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/srv/app",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = "/srv/app",
        identityRefId = "identity-1",
    )

    private fun safeWorktree(): RemoteRepositoryWorktree = RemoteRepositoryWorktree(
        path = "/srv/app-feature",
        branch = "feature/android",
        isPrimary = false,
        isLinked = true,
        isBare = false,
        isLocked = false,
        isMissing = false,
        isDirty = false,
        changeCount = 0,
    )

    private class FakeSshClient(
        private val fingerprint: String = "SHA256:test",
        private val result: SshCommandResult = SshCommandResult(ok = true, stdout = "ok"),
    ) : SshClientFacade {
        var lastScript: String = ""

        override fun fetchHostFingerprint(target: RemoteTarget): String = fingerprint

        override fun runDiagnosticProbe(
            target: RemoteTarget,
            probe: SshDiagnosticProbe,
            secrets: SshConnectionSecrets,
        ): SshCommandResult = SshCommandResult(ok = true)

        override fun runCommand(
            target: RemoteTarget,
            script: String,
            secrets: SshConnectionSecrets,
        ): SshCommandResult {
            lastScript = script
            return result
        }
    }

    private class FakeHostKeyTrustStore(
        private var trustedFingerprint: String?,
    ) : HostKeyTrustStore {
        override fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust =
            HostKeyTrustPolicy.evaluate(trustedFingerprint, fingerprint)

        override fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted {
            trustedFingerprint = fingerprint
            return HostKeyTrust.Trusted(fingerprint)
        }
    }
}
