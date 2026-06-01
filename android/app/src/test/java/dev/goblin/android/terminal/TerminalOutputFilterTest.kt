package dev.goblin.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalOutputFilterTest {
    @Test
    fun `strips bracketed paste private mode sequences`() {
        val filter = TerminalOutputFilter()

        assertEquals("ready\n", filter.append("\u001B[?2004hready\n\u001B[?2004l"))
    }

    @Test
    fun `strips sgr color sequences but preserves text`() {
        val filter = TerminalOutputFilter()

        assertEquals("red\n", filter.append("\u001B[31mred\u001B[0m\n"))
    }

    @Test
    fun `strips osc title sequences`() {
        val filter = TerminalOutputFilter()

        assertEquals("prompt", filter.append("\u001B]0;title\u0007prompt"))
    }

    @Test
    fun `buffers split csi sequence across chunks`() {
        val filter = TerminalOutputFilter()

        assertEquals("", filter.append("\u001B[?20"))
        assertEquals("ready", filter.append("04hready"))
    }

    @Test
    fun `strips raw bracketed paste markers when escape byte was already lost`() {
        val filter = TerminalOutputFilter()

        assertEquals("prompt", filter.append("[?2004hprompt[?2004l"))
    }

    @Test
    fun `strips raw bracketed paste marker variant seen in android viewport`() {
        val filter = TerminalOutputFilter()

        assertEquals("prompt", filter.append("[?20041h]prompt"))
    }
}
