package dev.goblin.android.domain.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteTargetTest {
    @Test
    fun `remote target from host profile defaults blank path to root`() {
        val profile = SshHostProfile.create(
            alias = "Dev",
            host = " example.com ",
            user = " lee ",
            port = 2200,
            identityRefId = "identity-1",
        )

        val target = RemoteTarget.fromHostProfile(profile, remotePath = " ")

        assertEquals("example.com", target.host)
        assertEquals("lee", target.user)
        assertEquals(2200, target.port)
        assertEquals("/", target.remotePath)
        assertEquals("identity-1", target.identityRefId)
        assertEquals("lee@example.com:2200/", target.id)
        assertEquals("lee@example.com:2200", target.authority)
    }

    @Test
    fun `remote target preserves normalized repository path in stable id`() {
        val profile = SshHostProfile.create(
            alias = "Dev",
            host = "example.com",
            user = "lee",
            identityRefId = "identity-1",
        )

        val target = RemoteTarget.fromHostProfile(profile, remotePath = " /srv/app ")

        assertEquals("/srv/app", target.remotePath)
        assertEquals("lee@example.com:22/srv/app", target.id)
    }
}

