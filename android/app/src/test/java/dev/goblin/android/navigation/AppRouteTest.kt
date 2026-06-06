package dev.goblin.android.navigation

import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class AppRouteTest {
    @Test
    fun `terminal route carries session identity from record`() {
        val record = TerminalSessionRecord(
            id = "session-1",
            hostId = "host-1",
            repositoryId = "repo-1",
            remotePath = "/srv/app",
            targetLabel = "App - /srv/app",
            status = TerminalSessionStatus.Running,
            openedAt = 100,
        )

        val route = AppRoute.terminal(record)

        assertEquals("host-1", route.hostId)
        assertEquals("/srv/app", route.remotePath)
        assertEquals("repo-1", route.repositoryId)
        assertEquals("session-1", route.terminalSessionId)
    }
}
