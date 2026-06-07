package dev.goblin.android.terminals.emulator

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTerminalOutputTest {
    @Test
    fun `write forwards only requested byte range`() {
        val sent = mutableListOf<String>()
        val output = RemoteTerminalOutput(
            sendInputBytes = { bytes ->
                sent += bytes.toString(Charsets.UTF_8)
                true
            },
        )

        output.write("xABCy".toByteArray(Charsets.UTF_8), 1, 3)

        assertEquals(listOf("ABC"), sent)
    }

    @Test
    fun `detached output refuses future writes`() {
        val sent = mutableListOf<String>()
        val output = RemoteTerminalOutput(
            sendInputBytes = { bytes ->
                sent += bytes.toString(Charsets.UTF_8)
                true
            },
        )

        output.detach()

        output.write("ignored".toByteArray(Charsets.UTF_8), 0, 7)

        assertTrue(output.isDetached)
        assertEquals(emptyList<String>(), sent)
    }

    @Test
    fun `callbacks are stored for UI consumers`() {
        var copied: String? = null
        var pasteRequested = false
        var bellCount = 0
        var colorsChanged = false
        var title: String? = null
        val output = RemoteTerminalOutput(
            sendInputBytes = { true },
            onCopyText = { copied = it },
            onPasteRequested = { pasteRequested = true },
            onBell = { bellCount += 1 },
            onColorsChanged = { colorsChanged = true },
            onTitleChanged = { title = it },
        )

        output.titleChanged("old", "new")
        output.onCopyTextToClipboard("copy")
        output.onPasteTextFromClipboard()
        output.onBell()
        output.onColorsChanged()

        assertEquals("new", title)
        assertEquals("copy", copied)
        assertTrue(pasteRequested)
        assertEquals(1, bellCount)
        assertTrue(colorsChanged)
        assertFalse(output.isDetached)
    }
}
