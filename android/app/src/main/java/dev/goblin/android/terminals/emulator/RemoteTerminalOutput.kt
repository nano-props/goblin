package dev.goblin.android.terminals.emulator

import com.termux.terminal.TerminalOutput

class RemoteTerminalOutput(
    private val sendInputBytes: (ByteArray) -> Boolean,
    private val onTitleChanged: (String?) -> Unit = {},
    private val onCopyText: (String) -> Unit = {},
    private val onPasteRequested: () -> Unit = {},
    private val onBell: () -> Unit = {},
    private val onColorsChanged: () -> Unit = {},
) : TerminalOutput() {
    var isDetached: Boolean = false
        private set

    override fun write(data: ByteArray, offset: Int, count: Int) {
        if (isDetached || count <= 0) return
        sendInputBytes(data.copyOfRange(offset, offset + count))
    }

    override fun titleChanged(oldTitle: String?, newTitle: String?) {
        onTitleChanged(newTitle)
    }

    override fun onCopyTextToClipboard(text: String) {
        onCopyText(text)
    }

    override fun onPasteTextFromClipboard() {
        onPasteRequested()
    }

    override fun onBell() {
        onBell.invoke()
    }

    override fun onColorsChanged() {
        onColorsChanged.invoke()
    }

    fun detach() {
        isDetached = true
    }
}
