package dev.goblin.android.ui.screens.terminal

import android.view.KeyEvent
import dev.goblin.android.terminal.TerminalDisconnectedReason
import dev.goblin.android.terminal.TerminalSessionState

internal const val TerminalDisconnectedMessage = "Terminal disconnected. Reconnect or return to diagnostics."

internal const val TerminalBackKeepsSessionHint = "Back leaves the session running in the background."

internal const val TerminalBackClosesSessionHint = "Back stops this temporary terminal."

internal const val TerminalStickToBottomThresholdPx = 48

internal fun terminalStickToBottom(
    scrollValue: Int,
    maxValue: Int,
    thresholdPx: Int = TerminalStickToBottomThresholdPx,
): Boolean = maxValue == 0 || scrollValue >= maxValue - thresholdPx

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

internal fun terminalControlCharacter(key: Char): String? {
    val letter = key.uppercaseChar()
    if (letter !in 'A'..'Z') return null
    return (letter.code - 'A'.code + 1).toChar().toString()
}

internal fun terminalControlInput(keyCode: Int, ctrlPressed: Boolean, action: Int = KeyEvent.ACTION_DOWN): String? {
    if (!ctrlPressed || action != KeyEvent.ACTION_DOWN) return null
    return when (keyCode) {
        KeyEvent.KEYCODE_C -> "\u0003"
        in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> {
            val letter = ('A'.code + (keyCode - KeyEvent.KEYCODE_A)).toChar()
            terminalControlCharacter(letter)
        }
        else -> null
    }
}

internal fun terminalViewportText(state: TerminalSessionState): String = when (state) {
    is TerminalSessionState.Connected -> state.output
    is TerminalSessionState.Failed -> state.output
    is TerminalSessionState.Exited -> state.output
    is TerminalSessionState.Disconnected -> state.output
    TerminalSessionState.Connecting,
    is TerminalSessionState.Resizing,
    TerminalSessionState.Idle,
    -> ""
}

internal fun terminalSessionBannerMessage(state: TerminalSessionState): String? = when (state) {
    TerminalSessionState.Connecting -> "Connecting..."
    is TerminalSessionState.Resizing -> "Resizing..."
    is TerminalSessionState.Failed -> "$TerminalDisconnectedMessage\n${state.message}"
    is TerminalSessionState.Exited -> "Terminal exited: ${terminalReasonLabel(state.reason)}"
    is TerminalSessionState.Disconnected -> "Terminal disconnected: ${terminalReasonLabel(state.reason)}"
    TerminalSessionState.Idle,
    is TerminalSessionState.Connected,
    -> null
}

internal fun terminalDisplayText(state: TerminalSessionState): String {
    val viewport = terminalViewportText(state)
    val banner = terminalSessionBannerMessage(state) ?: return viewport
    return if (viewport.isBlank()) banner else "$viewport\n$banner"
}

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
