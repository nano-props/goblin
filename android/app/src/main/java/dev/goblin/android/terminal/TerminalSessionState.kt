package dev.goblin.android.terminal

sealed interface TerminalSessionState {
    data object Idle : TerminalSessionState
    data object Connecting : TerminalSessionState
    data class Connected(
        val sessionId: String,
        val output: String,
        val cols: Int,
        val rows: Int,
    ) : TerminalSessionState
    data class Resizing(val sessionId: String, val cols: Int, val rows: Int) : TerminalSessionState
    data class Exited(val sessionId: String, val exitMessage: String = "exited") : TerminalSessionState
    data class Failed(val message: String, val cause: Throwable? = null) : TerminalSessionState
}

