package dev.goblin.android.data

import dev.goblin.android.domain.ssh.SshHostProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class HostProfileStoreTest {
    @Test
    fun `host profile defaults port to 22`() {
        val profile = SshHostProfile.create(alias = "Dev", host = "example.com", user = "lee")

        assertEquals(22, profile.port)
    }

    @Test
    fun `host profile rejects invalid port values outside allowed range`() {
        assertThrows(IllegalArgumentException::class.java) {
            SshHostProfile.create(alias = null, host = "example.com", user = "lee", port = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SshHostProfile.create(alias = null, host = "example.com", user = "lee", port = 65536)
        }
    }

    @Test
    fun `host profiles round trip through serialized storage payload`() {
        val profile = SshHostProfile.create(alias = "Dev", host = "example.com", user = "lee", port = 2200)

        val decoded = HostProfileCodec.decode(HostProfileCodec.encode(listOf(profile)))

        assertEquals(listOf(profile), decoded)
    }

    @Test
    fun `host profile update preserves id and normalizes editable fields`() {
        val existing = SshHostProfile.create(alias = "Old", host = "old.example.com", user = "lee")

        val updated = SshHostProfile.update(
            existing = existing,
            alias = "  Dev box  ",
            host = "  dev.example.com  ",
            user = "  deploy  ",
            port = 2200,
            identityRefId = " identity-1 ",
        )

        assertEquals(existing.id, updated.id)
        assertEquals("Dev box", updated.alias)
        assertEquals("dev.example.com", updated.host)
        assertEquals("deploy", updated.user)
        assertEquals(2200, updated.port)
        assertEquals("identity-1", updated.identityRefId)
    }

    @Test
    fun `host profile deletion removes only the matching local record`() {
        val first = SshHostProfile.create(alias = "One", host = "one.example.com", user = "lee")
        val second = SshHostProfile.create(alias = "Two", host = "two.example.com", user = "lee")

        val remaining = HostProfileStorePolicy.deleteHost(listOf(first, second), first.id)

        assertEquals(listOf(second), remaining)
    }

    @Test
    fun `serialized host profile payload excludes secret field names`() {
        val profile = SshHostProfile.create(alias = "Dev", host = "example.com", user = "lee")

        val payload = HostProfileCodec.encode(listOf(profile))

        assertFalse(payload.contains("passphrase", ignoreCase = true))
        assertFalse(payload.contains("password", ignoreCase = true))
        assertFalse(payload.contains("privateKey", ignoreCase = true))
        assertFalse(payload.contains("rawKey", ignoreCase = true))
        assertFalse(payload.contains("identityBytes", ignoreCase = true))
        assertFalse(payload.contains("terminal", ignoreCase = true))
        assertFalse(payload.contains("session", ignoreCase = true))
        assertFalse(payload.contains("socket", ignoreCase = true))
        assertFalse(payload.contains("portForward", ignoreCase = true))
        assertTrue(payload.isNotBlank())
    }
}
