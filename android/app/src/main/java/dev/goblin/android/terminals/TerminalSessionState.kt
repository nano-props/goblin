package dev.goblin.android.terminals

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
    data class Exited(
        val sessionId: String,
        val exitMessage: String = "exited",
        val reason: TerminalDisconnectedReason = TerminalDisconnectedReason.RemoteExited,
        val output: String = "",
    ) : TerminalSessionState
    data class Failed(
        val message: String,
        val cause: Throwable? = null,
        val reason: TerminalDisconnectedReason = TerminalDisconnectedReason.TerminalFailure,
        val sessionId: String? = null,
        val output: String = "",
    ) : TerminalSessionState
    data class Disconnected(
        val sessionId: String,
        val reason: TerminalDisconnectedReason,
        val message: String = "disconnected",
        val output: String = "",
    ) : TerminalSessionState
}
