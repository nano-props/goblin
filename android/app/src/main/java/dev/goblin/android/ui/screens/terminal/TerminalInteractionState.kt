package dev.goblin.android.ui.screens.terminal

import dev.goblin.android.terminal.TerminalSessionState

internal const val TerminalDisconnectedMessage = "Terminal disconnected. Reconnect or return to diagnostics."

internal fun terminalInputAvailable(state: TerminalSessionState): Boolean =
    state is TerminalSessionState.Connected

internal fun terminalReconnectAvailable(state: TerminalSessionState): Boolean = when (state) {
    TerminalSessionState.Idle,
    is TerminalSessionState.Exited,
    is TerminalSessionState.Failed,
    -> true
    TerminalSessionState.Connecting,
    is TerminalSessionState.Connected,
    is TerminalSessionState.Resizing,
    -> false
}

internal fun terminalInputUnavailableMessage(state: TerminalSessionState): String? = when (state) {
    TerminalSessionState.Idle -> "Terminal is not connected."
    TerminalSessionState.Connecting -> "Connecting to terminal..."
    is TerminalSessionState.Connected -> null
    is TerminalSessionState.Resizing -> "Terminal is resizing..."
    is TerminalSessionState.Exited,
    is TerminalSessionState.Failed,
    -> TerminalDisconnectedMessage
}

internal fun terminalLineInput(value: String): String = "$value\r"

internal fun terminalTargetLabel(repositoryTitle: String?, remotePath: String): String {
    val path = remotePath.ifBlank { "/" }
    val title = repositoryTitle?.takeIf { it.isNotBlank() }
    return if (title == null) path else "$title - $path"
}
