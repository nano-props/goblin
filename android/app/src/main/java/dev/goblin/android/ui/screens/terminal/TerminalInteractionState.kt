package dev.goblin.android.ui.screens.terminal

import dev.goblin.android.terminal.TerminalDisconnectedReason
import dev.goblin.android.terminal.TerminalSessionState

internal const val TerminalDisconnectedMessage = "Terminal disconnected. Reconnect or return to diagnostics."

internal fun terminalInputAvailable(state: TerminalSessionState): Boolean =
    state is TerminalSessionState.Connected

internal fun terminalReconnectAvailable(state: TerminalSessionState): Boolean = when (state) {
    TerminalSessionState.Idle,
    is TerminalSessionState.Exited,
    is TerminalSessionState.Failed,
    is TerminalSessionState.Disconnected,
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
    is TerminalSessionState.Disconnected,
    -> TerminalDisconnectedMessage
}

internal fun terminalLineInput(value: String): String = "$value\r"

internal fun terminalDisplayText(state: TerminalSessionState): String = when (state) {
    is TerminalSessionState.Connected -> state.output
    is TerminalSessionState.Failed -> inactiveTerminalText(
        output = state.output,
        message = "$TerminalDisconnectedMessage\n${state.message}",
    )
    is TerminalSessionState.Exited -> inactiveTerminalText(
        output = state.output,
        message = "Terminal exited: ${terminalReasonLabel(state.reason)}",
    )
    is TerminalSessionState.Disconnected -> inactiveTerminalText(
        output = state.output,
        message = "Terminal disconnected: ${terminalReasonLabel(state.reason)}",
    )
    TerminalSessionState.Connecting -> "Connecting..."
    is TerminalSessionState.Resizing -> "Resizing..."
    TerminalSessionState.Idle -> ""
}

private fun inactiveTerminalText(output: String, message: String): String =
    if (output.isBlank()) message else "$output\n$message"

private fun terminalReasonLabel(reason: TerminalDisconnectedReason): String = when (reason) {
    TerminalDisconnectedReason.UserClosed -> "User closed"
    TerminalDisconnectedReason.RemoteExited -> "Remote exited"
    TerminalDisconnectedReason.SshDisconnected -> "SSH disconnected"
    TerminalDisconnectedReason.AndroidServiceStopped -> "Android service stopped"
    TerminalDisconnectedReason.TerminalFailure -> "Terminal failure"
}

internal fun terminalTargetLabel(repositoryTitle: String?, remotePath: String): String {
    val path = remotePath.ifBlank { "/" }
    val title = repositoryTitle?.takeIf { it.isNotBlank() }
    return if (title == null) path else "$title - $path"
}
