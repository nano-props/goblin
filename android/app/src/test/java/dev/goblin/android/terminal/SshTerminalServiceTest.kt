package dev.goblin.android.terminal

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SshTerminalServiceTest {
    @Test
    fun `terminal host key policy rejects unknown host key`() {
        val store = FakeHostKeyTrustStore()

        assertFalse(TerminalHostKeyPolicy.accepts(target(), "SHA256:new", null, store))
    }

    @Test
    fun `terminal host key policy accepts trusted host key`() {
        val store = FakeHostKeyTrustStore(trustedFingerprint = "SHA256:trusted")

        assertTrue(TerminalHostKeyPolicy.accepts(target(), "SHA256:trusted", null, store))
    }

    @Test
    fun `terminal host key policy rejects changed host key`() {
        val store = FakeHostKeyTrustStore(trustedFingerprint = "SHA256:old")

        assertFalse(TerminalHostKeyPolicy.accepts(target(), "SHA256:new", null, store))
    }

    @Test
    fun `terminal host key policy accepts explicit fingerprint`() {
        assertTrue(TerminalHostKeyPolicy.accepts(target(), "SHA256:current", "SHA256:current", null))
    }

    private fun target(): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = "/",
        identityRefId = null,
    )

    private class FakeHostKeyTrustStore(
        private var trustedFingerprint: String? = null,
    ) : HostKeyTrustStore {
        override fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust {
            val trusted = trustedFingerprint ?: return HostKeyTrust.Unknown
            return if (trusted == fingerprint) {
                HostKeyTrust.Trusted(fingerprint)
            } else {
                HostKeyTrust.Changed(
                    previousFingerprint = trusted,
                    currentFingerprint = fingerprint,
                )
            }
        }

        override fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted {
            trustedFingerprint = fingerprint
            return HostKeyTrust.Trusted(fingerprint)
        }
    }
}
