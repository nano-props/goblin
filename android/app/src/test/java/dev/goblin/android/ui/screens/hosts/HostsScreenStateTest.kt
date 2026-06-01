package dev.goblin.android.ui.screens.hosts

import androidx.compose.ui.graphics.Color
import dev.goblin.android.domain.ssh.SshHostProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostsScreenStateTest {
    @Test
    fun `host temporary terminal opens at home directory without a project`() {
        assertEquals("~", HOST_TEMPORARY_TERMINAL_REMOTE_PATH)
        assertTrue(isHostTemporaryTerminal("~", repositoryId = null))
        assertFalse(isHostTemporaryTerminal("/", repositoryId = null))
        assertFalse(isHostTemporaryTerminal("~", repositoryId = "repo-1"))
    }

    @Test
    fun `host temporary terminal route defers session startup to terminal screen`() {
        val route = hostTemporaryTerminalRoute("host-1")

        assertEquals("host-1", route.hostId)
        assertEquals(HOST_TEMPORARY_TERMINAL_REMOTE_PATH, route.remotePath)
        assertNull(route.repositoryId)
        assertNull(route.terminalSessionId)
    }

    @Test
    fun `host health defaults to offline`() {
        assertEquals(HostHealth.Offline, hostHealth(host(lastDiagnosticStatus = null)))
    }

    @Test
    fun `host health only exposes online and offline states`() {
        assertEquals(listOf("online", "offline"), HostHealth.entries.map(::hostHealthLabel))
    }

    @Test
    fun `host health maps persisted diagnostics to online and offline labels`() {
        assertEquals(HostHealth.Online, hostHealth(host(lastDiagnosticStatus = "healthy")))
        assertEquals(HostHealth.Offline, hostHealth(host(lastDiagnosticStatus = "unhealthy")))
        assertEquals(HostHealth.Offline, hostHealth(host(lastDiagnosticStatus = "pending")))
        assertEquals("online", hostHealthLabel(HostHealth.Online))
        assertEquals("offline", hostHealthLabel(HostHealth.Offline))
    }

    @Test
    fun `host health indicator colors are scoped to the status dot`() {
        assertEquals(Color(0xFF137333), hostHealthIndicatorColor(HostHealth.Online))
        assertEquals(Color(0xFFC5221F), hostHealthIndicatorColor(HostHealth.Offline))
    }

    private fun host(lastDiagnosticStatus: String?): SshHostProfile =
        SshHostProfile.create(
            alias = "Dev",
            host = "example.com",
            user = "lee",
            identityRefId = "identity-1",
        ).copy(lastDiagnosticStatus = lastDiagnosticStatus)
}
