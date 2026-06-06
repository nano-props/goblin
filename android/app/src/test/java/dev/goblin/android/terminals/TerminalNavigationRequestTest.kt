package dev.goblin.android.terminals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalNavigationRequestTest {
    @Test
    fun `navigation request uses monotonic sequence for repeated opens`() {
        val first = TerminalNavigationRequest(sessionId = "session-1", sequence = 1L)
        val second = TerminalNavigationRequest(sessionId = "session-1", sequence = 2L)

        assertEquals("session-1", first.sessionId)
        assertEquals("session-1", second.sessionId)
        assertTrue(second.sequence > first.sequence)
    }
}
