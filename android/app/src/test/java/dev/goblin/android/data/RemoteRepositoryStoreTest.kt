package dev.goblin.android.data

import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteRepositoryStoreTest {
    @Test
    fun `remote repository profile normalizes display fields`() {
        val repo = RemoteRepositoryProfile.create(
            hostProfileId = " host-1 ",
            alias = " App ",
            remotePath = " /srv/app ",
        )

        assertEquals("host-1", repo.hostProfileId)
        assertEquals("App", repo.alias)
        assertEquals("/srv/app", repo.remotePath)
        assertEquals("App", repo.title)
    }

    @Test
    fun `remote repository profile requires an absolute remote path`() {
        assertThrows(IllegalArgumentException::class.java) {
            RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = null, remotePath = "")
        }
        assertThrows(IllegalArgumentException::class.java) {
            RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = null, remotePath = "srv/app")
        }
    }

    @Test
    fun `remote repositories round trip through serialized storage payload`() {
        val repo = RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = "App", remotePath = "/srv/app")

        val decoded = RemoteRepositoryCodec.decode(RemoteRepositoryCodec.encode(listOf(repo)))

        assertEquals(listOf(repo), decoded)
    }

    @Test
    fun `remote repository delete removes only the local record`() {
        val first = RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = "App", remotePath = "/srv/app")
        val second = RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = "API", remotePath = "/srv/api")

        val remaining = RemoteRepositoryStorePolicy.deleteRepository(listOf(first, second), first.id)

        assertEquals(listOf(second), remaining)
    }

    @Test
    fun `host deletion removes associated local remote repository records`() {
        val removed = RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = "App", remotePath = "/srv/app")
        val kept = RemoteRepositoryProfile.create(hostProfileId = "host-2", alias = "API", remotePath = "/srv/api")

        val remaining = RemoteRepositoryStorePolicy.deleteByHostId(listOf(removed, kept), "host-1")

        assertEquals(listOf(kept), remaining)
    }

    @Test
    fun `serialized remote repository payload excludes secret field names`() {
        val repo = RemoteRepositoryProfile.create(hostProfileId = "host-1", alias = "App", remotePath = "/srv/app")

        val payload = RemoteRepositoryCodec.encode(listOf(repo))

        assertFalse(payload.contains("passphrase", ignoreCase = true))
        assertFalse(payload.contains("password", ignoreCase = true))
        assertFalse(payload.contains("privateKey", ignoreCase = true))
        assertFalse(payload.contains("rawKey", ignoreCase = true))
        assertFalse(payload.contains("identityBytes", ignoreCase = true))
        assertFalse(payload.contains("terminal", ignoreCase = true))
        assertFalse(payload.contains("session", ignoreCase = true))
        assertFalse(payload.contains("socket", ignoreCase = true))
        assertFalse(payload.contains("portForward", ignoreCase = true))
        assertFalse(payload.contains("tunnel", ignoreCase = true))
        assertTrue(payload.isNotBlank())
    }
}
