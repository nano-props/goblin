package dev.goblin.android.ui.screens.terminal

import android.view.KeyEvent
import dev.goblin.android.terminal.TerminalSessionState
import dev.goblin.android.terminal.TerminalDisconnectedReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalInteractionStateTest {
    @Test
    fun `input is unavailable until terminal is connected`() {
        assertFalse(terminalInputAvailable(TerminalSessionState.Idle))
        assertFalse(terminalInputAvailable(TerminalSessionState.Connecting))
        assertFalse(
            terminalInputAvailable(
                TerminalSessionState.Disconnected(
                    sessionId = "session-1",
                    reason = TerminalDisconnectedReason.AndroidServiceStopped,
                ),
            ),
        )
        assertTrue(terminalInputAvailable(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `reconnect is available only after terminal is inactive`() {
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Idle))
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Exited("session-1")))
        assertTrue(terminalReconnectAvailable(TerminalSessionState.Failed("lost")))
        assertFalse(terminalReconnectAvailable(TerminalSessionState.Connecting))
        assertFalse(terminalReconnectAvailable(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `unavailable input state explains why send is disabled`() {
        assertEquals("Connecting to terminal...", terminalInputUnavailableMessage(TerminalSessionState.Connecting))
        assertEquals(
            "Terminal disconnected. Reconnect or return to diagnostics.",
            terminalInputUnavailableMessage(TerminalSessionState.Exited("session-1")),
        )
        assertNull(terminalInputUnavailableMessage(TerminalSessionState.Connected("session-1", "", 80, 24)))
    }

    @Test
    fun `viewport keeps output while banner carries disconnect reason`() {
        val disconnected = TerminalSessionState.Disconnected(
            sessionId = "session-1",
            reason = TerminalDisconnectedReason.AndroidServiceStopped,
            output = "last output",
        )

        assertEquals("last output", terminalViewportText(disconnected))
        val banner = terminalSessionBannerMessage(disconnected)
        assertTrue(banner!!.contains("disconnected", ignoreCase = true))
        assertTrue(banner.contains("Android service stopped"))
    }

    @Test
    fun `connecting shows banner without replacing viewport buffer`() {
        assertEquals("", terminalViewportText(TerminalSessionState.Connecting))
        assertEquals("Connecting...", terminalSessionBannerMessage(TerminalSessionState.Connecting))
    }

    @Test
    fun `display text combines viewport and banner for compatibility`() {
        val text = terminalDisplayText(
            TerminalSessionState.Disconnected(
                sessionId = "session-1",
                reason = TerminalDisconnectedReason.AndroidServiceStopped,
                output = "last output",
            ),
        )

        assertTrue(text.contains("last output"))
        assertTrue(text.contains("disconnected", ignoreCase = true))
    }

    @Test
    fun `line input uses carriage return for PTY enter`() {
        assertEquals("pwd\r", terminalLineInput("pwd"))
    }

    @Test
    fun `control character maps letters to terminal bytes`() {
        assertEquals("\u0001", terminalControlCharacter('a'))
        assertEquals("\u0003", terminalControlCharacter('C'))
        assertNull(terminalControlCharacter('1'))
    }

    @Test
    fun `control input maps ctrl+c and other ctrl letters from key codes`() {
        assertEquals("\u0003", terminalControlInput(KeyEvent.KEYCODE_C, ctrlPressed = true))
        assertEquals("\u0004", terminalControlInput(KeyEvent.KEYCODE_D, ctrlPressed = true))
        assertNull(terminalControlInput(KeyEvent.KEYCODE_C, ctrlPressed = false))
        assertNull(terminalControlInput(KeyEvent.KEYCODE_ENTER, ctrlPressed = true))
    }

    @Test
    fun `stick to bottom follows scroll position`() {
        assertTrue(terminalStickToBottom(scrollValue = 0, maxValue = 0))
        assertTrue(terminalStickToBottom(scrollValue = 952, maxValue = 1000))
        assertTrue(terminalStickToBottom(scrollValue = 952, maxValue = 1000, thresholdPx = 48))
        assertFalse(terminalStickToBottom(scrollValue = 900, maxValue = 1000, thresholdPx = 48))
    }

    @Test
    fun `terminal target label includes repository and worktree path`() {
        assertEquals(
            "App - /srv/app-feature",
            terminalTargetLabel(repositoryTitle = "App", remotePath = "/srv/app-feature"),
        )
    }
}
