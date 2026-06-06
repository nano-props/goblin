package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustPolicy
import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteBranchServiceTest {
    @Test
    fun `create and checkout branch is blocked until host key is trusted`() {
        val service = RemoteBranchService(
            client = FakeSshClient(),
            hostKeyStore = FakeHostKeyTrustStore(null),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.createAndCheckoutBranch(
                target = target(),
                baseBranch = "main",
                newBranch = "main-new",
            )
        }

        assertEquals("Trust this host key before changing remote branches.", error.message)
    }

    @Test
    fun `create and checkout branch runs quoted checkout command`() {
        val client = FakeSshClient()
        val service = RemoteBranchService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        service.createAndCheckoutBranch(
            target = target(),
            baseBranch = "feature/android",
            newBranch = "feature/android-new",
        )

        assertTrue(client.lastScript.contains("git -C '/srv/app' checkout -b 'feature/android-new' 'feature/android'"))
    }

    @Test
    fun `create and checkout branch surfaces git failure message`() {
        val service = RemoteBranchService(
            client = FakeSshClient(
                result = SshCommandResult(ok = false, stderr = "fatal: branch already exists"),
            ),
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.createAndCheckoutBranch(
                target = target(),
                baseBranch = "main",
                newBranch = "main-new",
            )
        }

        assertEquals("fatal: branch already exists", error.message)
    }

    @Test
    fun `delete branch is blocked until host key is trusted`() {
        val service = RemoteBranchService(
            client = FakeSshClient(),
            hostKeyStore = FakeHostKeyTrustStore(null),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.deleteBranch(target = target(), branch = "feature/android")
        }

        assertEquals("Trust this host key before changing remote branches.", error.message)
    }

    @Test
    fun `delete branch runs quoted safe branch delete command`() {
        val client = FakeSshClient()
        val service = RemoteBranchService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        service.deleteBranch(target = target(), branch = "feature/android")

        assertTrue(client.lastScript.contains("git -C '/srv/app' branch -d 'feature/android'"))
    }

    @Test
    fun `delete branch surfaces git failure message`() {
        val service = RemoteBranchService(
            client = FakeSshClient(
                result = SshCommandResult(ok = false, stderr = "error: The branch is not fully merged."),
            ),
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.deleteBranch(target = target(), branch = "feature/android")
        }

        assertEquals("error: The branch is not fully merged.", error.message)
    }

    @Test
    fun `checkout branch runs quoted checkout command`() {
        val client = FakeSshClient()
        val service = RemoteBranchService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        service.checkoutBranch(target = target(), branch = "feature/android")

        assertTrue(client.lastScript.contains("git -C '/srv/app' checkout 'feature/android'"))
    }

    @Test
    fun `checkout branch surfaces git failure message`() {
        val service = RemoteBranchService(
            client = FakeSshClient(
                result = SshCommandResult(ok = false, stderr = "error: Your local changes would be overwritten."),
            ),
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.checkoutBranch(target = target(), branch = "feature/android")
        }

        assertEquals("error: Your local changes would be overwritten.", error.message)
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
