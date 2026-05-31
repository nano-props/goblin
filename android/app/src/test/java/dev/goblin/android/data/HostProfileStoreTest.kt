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
    fun `serialized host profile payload excludes secret field names`() {
        val profile = SshHostProfile.create(alias = "Dev", host = "example.com", user = "lee")

        val payload = HostProfileCodec.encode(listOf(profile))

        assertFalse(payload.contains("passphrase", ignoreCase = true))
        assertFalse(payload.contains("password", ignoreCase = true))
        assertFalse(payload.contains("privateKey", ignoreCase = true))
        assertFalse(payload.contains("rawKey", ignoreCase = true))
        assertTrue(payload.isNotBlank())
    }
}

