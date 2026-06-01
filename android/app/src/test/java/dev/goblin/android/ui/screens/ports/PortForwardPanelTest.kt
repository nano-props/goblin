package dev.goblin.android.ui.screens.ports

import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSession
import dev.goblin.android.domain.ssh.PortForwardSessionStatus
import dev.goblin.android.domain.ssh.SshHostProfile
import org.junit.Assert.assertEquals
import org.junit.Test

class PortForwardPanelTest {
    @Test
    fun `host maps to port forward owner`() {
        val host = host()

        val owner = hostPortForwardOwner(host)

        assertEquals(host.id, owner.id)
        assertEquals(host.title, owner.label)
    }

    @Test
    fun `port forward sessions are filtered by owner`() {
        val appSession = portForwardSession(ownerId = "host-1")
        val apiSession = portForwardSession(ownerId = "host-2")

        assertEquals(
            listOf(appSession),
            portForwardSessionsForOwner(listOf(appSession, apiSession), ownerId = "host-1"),
        )
    }

    @Test
    fun `active port forward actions expose open copy and stop`() {
        val session = portForwardSession(ownerId = "host-1")

        assertEquals(listOf("Open URL", "Copy URL", "Stop"), portForwardActionLabels(session))
    }

    @Test
    fun `active port forward lifecycle text is explicit about app runtime scope`() {
        val session = portForwardSession(ownerId = "host-1")

        assertEquals(
            "active in this app session - stop it when the emergency task is done",
            portForwardLifecycleText(session),
        )
    }

    @Test
    fun `failed port forward lifecycle text includes failure reason`() {
        val session = portForwardSession(ownerId = "host-1").copy(
            status = PortForwardSessionStatus.Failed,
            message = "connection refused",
        )

        assertEquals("failed - connection refused", portForwardLifecycleText(session))
    }

    private fun host(): SshHostProfile =
        SshHostProfile.create(
            alias = "Dev",
            host = "example.com",
            user = "lee",
            identityRefId = "identity-1",
        ).copy(id = "host-1")

    private fun portForwardSession(ownerId: String): PortForwardSession =
        PortForwardSession(
            id = "session-$ownerId",
            owner = PortForwardOwner(id = ownerId, label = "Host"),
            request = PortForwardRequest.create(remotePort = 3000),
            status = PortForwardSessionStatus.Active,
            localPort = 49152,
        )
}
