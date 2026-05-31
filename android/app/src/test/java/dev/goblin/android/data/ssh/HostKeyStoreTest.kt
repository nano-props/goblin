package dev.goblin.android.data.ssh

import dev.goblin.android.domain.ssh.HostKeyTrust
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HostKeyStoreTest {
    @Test
    fun `unknown host key requires first use trust`() {
        val trust = HostKeyTrustPolicy.evaluate(trustedFingerprint = null, currentFingerprint = "SHA256:new")

        assertEquals(HostKeyTrust.Unknown, trust)
    }

    @Test
    fun `trusted host key remains trusted when fingerprint matches`() {
        val trust = HostKeyTrustPolicy.evaluate(trustedFingerprint = "SHA256:known", currentFingerprint = "SHA256:known")

        assertEquals(HostKeyTrust.Trusted("SHA256:known"), trust)
    }

    @Test
    fun `trusted host key becomes changed when fingerprint differs`() {
        val trust = HostKeyTrustPolicy.evaluate(trustedFingerprint = "SHA256:old", currentFingerprint = "SHA256:new")

        assertTrue(trust is HostKeyTrust.Changed)
        assertEquals("SHA256:old", (trust as HostKeyTrust.Changed).previousFingerprint)
        assertEquals("SHA256:new", trust.currentFingerprint)
    }
}

