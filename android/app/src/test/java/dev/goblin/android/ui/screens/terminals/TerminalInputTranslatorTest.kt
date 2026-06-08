package dev.goblin.android.ui.screens.terminals

import android.view.KeyEvent
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TerminalInputTranslatorTest {
    @Test
    fun `text input maps newline to carriage return`() {
        assertArrayEquals(
            "a\rb".toByteArray(Charsets.UTF_8),
            terminalTextBytes("a\nb"),
        )
    }

    @Test
    fun `key code input maps terminal navigation keys`() {
        assertEquals("\u001B[A", terminalKeyBytes(KeyEvent.KEYCODE_DPAD_UP).asText())
        assertEquals("\u001B[B", terminalKeyBytes(KeyEvent.KEYCODE_DPAD_DOWN).asText())
        assertEquals("\u001B[D", terminalKeyBytes(KeyEvent.KEYCODE_DPAD_LEFT).asText())
        assertEquals("\u001B[C", terminalKeyBytes(KeyEvent.KEYCODE_DPAD_RIGHT).asText())
        assertEquals("\u001B", terminalKeyBytes(KeyEvent.KEYCODE_ESCAPE).asText())
        assertEquals("\t", terminalKeyBytes(KeyEvent.KEYCODE_TAB).asText())
        assertEquals("\r", terminalKeyBytes(KeyEvent.KEYCODE_ENTER).asText())
    }

    @Test
    fun `ctrl key input maps letters to control bytes`() {
        assertEquals("\u0003", terminalKeyBytes(KeyEvent.KEYCODE_C, ctrlPressed = true).asText())
        assertEquals("\u0004", terminalKeyBytes(KeyEvent.KEYCODE_D, ctrlPressed = true).asText())
    }

    @Test
    fun `key up does not emit terminal bytes`() {
        assertNull(terminalKeyBytes(KeyEvent.KEYCODE_ENTER, action = KeyEvent.ACTION_UP))
    }

    private fun ByteArray?.asText(): String? = this?.toString(Charsets.UTF_8)
}
