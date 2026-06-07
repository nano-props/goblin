package dev.goblin.android.ui.screens.terminals

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalTypefaceProviderTest {
    @Test
    fun `resource resolver returns bundled value when loading succeeds`() {
        assertEquals(
            "bundled",
            terminalResourceOrFallback(fallback = "fallback") { "bundled" },
        )
    }

    @Test
    fun `resource resolver falls back when loading throws`() {
        assertEquals(
            "fallback",
            terminalResourceOrFallback(fallback = "fallback") {
                throw IllegalArgumentException("missing terminal font")
            },
        )
    }

    @Test
    fun `resource resolver falls back when loading returns null`() {
        assertEquals(
            "fallback",
            terminalResourceOrFallback(fallback = "fallback") { null },
        )
    }
}
