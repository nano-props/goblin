package dev.goblin.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalNotificationFactoryTest {
    @Test
    fun `one running terminal notification uses singular count and target label`() {
        val content = TerminalNotificationFactory.contentFor(
            listOf(record(id = "terminal-1", label = "App - /srv/app", lastActivityAt = 200L)),
        )

        assertTrue(content.title.contains("1 terminal running"))
        assertTrue(content.text.contains("App - /srv/app"))
        assertEquals("terminal-1", content.terminalSessionId)
    }

    @Test
    fun `multiple running terminals notification uses plural count`() {
        val content = TerminalNotificationFactory.contentFor(
            listOf(
                record(id = "terminal-1", label = "App - /srv/app", lastActivityAt = 200L),
                record(id = "terminal-2", label = "Api - /srv/api", lastActivityAt = 300L),
            ),
        )

        assertTrue(content.title.contains("2 terminals running"))
    }

    @Test
    fun `notification routes to most recently active terminal`() {
        val content = TerminalNotificationFactory.contentFor(
            listOf(
                record(id = "terminal-1", label = "App - /srv/app", lastActivityAt = 500L),
                record(id = "terminal-2", label = "Api - /srv/api", lastActivityAt = 900L),
            ),
        )

        assertTrue(content.text.contains("Api - /srv/api"))
        assertEquals("terminal-2", content.terminalSessionId)
    }

    @Test
    fun `notification falls back to most recently opened running terminal`() {
        val content = TerminalNotificationFactory.contentFor(
            listOf(
                record(id = "terminal-1", label = "App - /srv/app", openedAt = 500L, lastActivityAt = null),
                record(id = "terminal-2", label = "Api - /srv/api", openedAt = 900L, lastActivityAt = null),
            ),
        )

        assertTrue(content.text.contains("Api - /srv/api"))
        assertEquals("terminal-2", content.terminalSessionId)
    }

    private fun record(
        id: String,
        label: String,
        openedAt: Long = 100L,
        lastActivityAt: Long?,
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = id,
        hostId = "host-1",
        repositoryId = "repo-1",
        remotePath = "/srv/app",
        targetLabel = label,
        status = TerminalSessionStatus.Running,
        openedAt = openedAt,
        lastActivityAt = lastActivityAt,
    )
}
