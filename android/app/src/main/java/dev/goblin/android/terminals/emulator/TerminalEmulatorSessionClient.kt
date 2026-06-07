package dev.goblin.android.terminals.emulator

import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient

internal class TerminalEmulatorSessionClient(
    private val onCursorStateChanged: (Boolean) -> Unit = {},
    private val onLog: (String, String) -> Unit = { _, _ -> },
) : TerminalSessionClient {
    override fun onTextChanged(changedSession: TerminalSession) = Unit
    override fun onTitleChanged(changedSession: TerminalSession) = Unit
    override fun onSessionFinished(finishedSession: TerminalSession) = Unit
    override fun onCopyTextToClipboard(session: TerminalSession, text: String) = Unit
    override fun onPasteTextFromClipboard(session: TerminalSession) = Unit
    override fun onBell(session: TerminalSession) = Unit
    override fun onColorsChanged(session: TerminalSession) = Unit
    override fun onTerminalCursorStateChange(state: Boolean) = onCursorStateChanged(state)
    override fun getTerminalCursorStyle(): Int = TerminalEmulator.DEFAULT_TERMINAL_CURSOR_STYLE
    override fun logError(tag: String, message: String) = onLog(tag, message)
    override fun logWarn(tag: String, message: String) = onLog(tag, message)
    override fun logInfo(tag: String, message: String) = Unit
    override fun logDebug(tag: String, message: String) = Unit
    override fun logVerbose(tag: String, message: String) = Unit
    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) = onLog(tag, message)
    override fun logStackTrace(tag: String, e: Exception) = onLog(tag, e.message.orEmpty())
}
