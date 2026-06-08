package dev.goblin.android.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class GoblinThemeTest {
    @Test
    fun `terminal banner colors use dark terminal contrast`() {
        assertEquals("#111827", GoblinColors.TerminalOverlayBackgroundHex)
        assertEquals(GoblinColors.TerminalForegroundHex, GoblinColors.TerminalOverlayForegroundHex)
        assertNotEquals("#FFFFFF", GoblinColors.TerminalOverlayBackgroundHex.uppercase())
    }

    @Test
    fun `terminal input colors use visible dark surface contrast`() {
        assertEquals("#111827", GoblinColors.TerminalInputBackgroundHex)
        assertEquals(GoblinColors.TerminalForegroundHex, GoblinColors.TerminalInputForegroundHex)
        assertEquals("#94A3B8", GoblinColors.TerminalInputPlaceholderHex)
        assertNotEquals(GoblinColors.TerminalBackgroundHex, GoblinColors.TerminalInputBorderHex)
    }
}
