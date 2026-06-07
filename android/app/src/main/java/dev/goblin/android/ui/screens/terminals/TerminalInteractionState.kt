package dev.goblin.android.ui.screens.terminals

import android.view.KeyEvent
import dev.goblin.android.terminals.TerminalDisconnectedReason
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionState
import dev.goblin.android.terminals.TerminalSessionStatus

internal const val TerminalDisconnectedMessage = "Terminal disconnected. Reconnect or return to diagnostics."

internal const val TerminalBackKeepsSessionHint = "Back leaves the session running in the background."

internal const val TerminalBackClosesSessionHint = "Back stops this temporary terminal."

internal const val TerminalQuickConfirmInput = "YES"
internal const val TerminalQuickCancelInput = "NO"

internal const val TerminalStickToBottomThresholdPx = 48

internal fun terminalHelperKeyLabels(ctrlModifierActive: Boolean): List<String> =
    listOf(
        "ENTER",
        "YES",
        "NO",
        "CTRL+C",
        "CTRL+L",
        "Tab",
        "Esc",
        if (ctrlModifierActive) "Ctrl on" else "Ctrl",
        "Up",
        "Down",
        "Left",
        "Right",
        "Paste",
    )

internal fun terminalTopBarVisible(terminalMaximized: Boolean): Boolean = !terminalMaximized

internal fun terminalMaximizeActionLabel(terminalMaximized: Boolean): String =
    if (terminalMaximized) "Restore" else "Maximize"

internal fun terminalRestoreInlineActionVisible(terminalMaximized: Boolean): Boolean = terminalMaximized

internal fun terminalSessionRemotePath(remotePath: String): String =
    remotePath.ifBlank { "/" }.trimEnd('/').ifEmpty { "/" }

private fun TerminalSessionStatus.terminalWorkspacePriority(): Int = when (this) {
    TerminalSessionStatus.Starting,
    TerminalSessionStatus.Running -> 0
    TerminalSessionStatus.Exited,
    TerminalSessionStatus.Failed,
    TerminalSessionStatus.Disconnected -> 1
}

private val terminalWorkspaceSessionComparator: Comparator<TerminalSessionRecord> =
    compareBy<TerminalSessionRecord> { it.status.terminalWorkspacePriority() }
        .thenByDescending { it.lastActivityAt ?: it.openedAt }
        .thenBy { it.openedAt }

private val terminalWorkspaceCreatedSessionComparator: Comparator<TerminalSessionRecord> =
    compareBy<TerminalSessionRecord> { it.openedAt }
        .thenBy { it.id }

internal fun terminalWorkspaceOrderedSessions(
    sessions: List<TerminalSessionRecord>,
    hostId: String,
    remotePath: String,
): List<TerminalSessionRecord> = terminalWorkspaceOrderedSessions(
    sessions = sessions,
    hostIds = setOf(hostId),
    remotePath = remotePath,
)

internal fun terminalWorkspaceOrderedSessions(
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
    remotePath: String,
): List<TerminalSessionRecord> {
    return terminalWorkspaceFilteredSessions(
        sessions = sessions,
        hostIds = hostIds,
        remotePath = remotePath,
    ).sortedWith(terminalWorkspaceSessionComparator)
}

internal fun terminalWorkspaceCreatedSessions(
    sessions: List<TerminalSessionRecord>,
    hostId: String,
    remotePath: String,
): List<TerminalSessionRecord> = terminalWorkspaceCreatedSessions(
    sessions = sessions,
    hostIds = setOf(hostId),
    remotePath = remotePath,
)

internal fun terminalWorkspaceCreatedSessions(
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
    remotePath: String,
): List<TerminalSessionRecord> {
    return terminalWorkspaceFilteredSessions(
        sessions = sessions,
        hostIds = hostIds,
        remotePath = remotePath,
    ).sortedWith(terminalWorkspaceCreatedSessionComparator)
}

internal fun terminalWorkspaceSessionCountsByPath(
    sessions: List<TerminalSessionRecord>,
    hostId: String,
): List<Pair<String, Int>> =
    terminalWorkspaceSessionCountsByPath(
        sessions = sessions,
        hostIds = setOf(hostId),
    )

internal fun terminalWorkspaceSessionCountsByPath(
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
): List<Pair<String, Int>> =
    terminalWorkspaceHostSessions(sessions = sessions, hostIds = hostIds)
        .groupBy { terminalSessionRemotePath(it.remotePath) }
        .map { (path, values) -> path to values.size }
        .sortedBy { it.first }

private fun terminalWorkspaceFilteredSessions(
    sessions: List<TerminalSessionRecord>,
    hostId: String,
    remotePath: String,
): List<TerminalSessionRecord> = terminalWorkspaceFilteredSessions(
    sessions = sessions,
    hostIds = setOf(hostId),
    remotePath = remotePath,
)

private fun terminalWorkspaceFilteredSessions(
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
    remotePath: String,
): List<TerminalSessionRecord> {
    val path = terminalSessionRemotePath(remotePath)
    return sessions.filter { it.hostId in hostIds && terminalSessionRemotePath(it.remotePath) == path }
}

private fun terminalWorkspaceHostSessions(
    sessions: List<TerminalSessionRecord>,
    hostId: String,
): List<TerminalSessionRecord> = terminalWorkspaceHostSessions(
    sessions = sessions,
    hostIds = setOf(hostId),
)

private fun terminalWorkspaceHostSessions(
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
): List<TerminalSessionRecord> {
    return sessions.filter { it.hostId in hostIds }
}

internal fun terminalStickToBottom(
    scrollValue: Int,
    maxValue: Int,
    thresholdPx: Int = TerminalStickToBottomThresholdPx,
): Boolean = maxValue == 0 || scrollValue >= maxValue - thresholdPx

internal fun terminalInputAvailable(state: TerminalSessionState): Boolean =
    state is TerminalSessionState.Connected

internal fun terminalCommandInputEnabled(state: TerminalSessionState): Boolean =
    terminalInputAvailable(state)

internal fun terminalCommandInputPlaceholder(state: TerminalSessionState): String =
    if (terminalCommandInputEnabled(state)) {
        "Type a command"
    } else {
        terminalInputUnavailableMessage(state) ?: "Terminal is not connected."
    }

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

internal data class TerminalDetailInlineActions(
    val reconnectEnabled: Boolean,
    val closeEnabled: Boolean,
)

internal fun terminalDetailInlineActions(state: TerminalSessionState): TerminalDetailInlineActions =
    TerminalDetailInlineActions(
        reconnectEnabled = terminalReconnectAvailable(state),
        closeEnabled = true,
    )

internal fun terminalCloseConfirmationText(targetLabel: String): String =
    "This will stop $targetLabel and return to the previous screen. You can reconnect it later from the terminal list."

internal fun terminalInputUnavailableMessage(state: TerminalSessionState): String? = when (state) {
    TerminalSessionState.Idle -> "Terminal is not connected."
    TerminalSessionState.Connecting -> "Connecting to terminal..."
    is TerminalSessionState.Connected -> null
    is TerminalSessionState.Resizing -> "Terminal is resizing..."
    is TerminalSessionState.Exited -> TerminalDisconnectedMessage
    is TerminalSessionState.Failed -> TerminalDisconnectedMessage
    is TerminalSessionState.Disconnected -> terminalDisconnectedMessage(state.reason, state.message)
}

internal fun terminalLineInput(value: String): String = "$value\r"

internal fun terminalQuickInput(value: String): String = "$value\r"

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

internal fun terminalFallbackVisible(hasEmulatorController: Boolean): Boolean =
    !hasEmulatorController

internal fun terminalSessionBannerMessage(state: TerminalSessionState): String? = when (state) {
    TerminalSessionState.Connecting -> "Connecting..."
    is TerminalSessionState.Resizing -> "Resizing..."
    is TerminalSessionState.Failed -> "$TerminalDisconnectedMessage\n${state.message}"
    is TerminalSessionState.Exited -> "Terminal exited: ${terminalReasonLabel(state.reason)}"
    is TerminalSessionState.Disconnected -> terminalDisconnectedMessage(state.reason, state.message)
    TerminalSessionState.Idle,
    is TerminalSessionState.Connected,
    -> null
}

internal fun terminalSessionStatusLabel(state: TerminalSessionState): String = when (state) {
    TerminalSessionState.Idle -> "idle"
    TerminalSessionState.Connecting -> "connecting"
    is TerminalSessionState.Connected -> "connected"
    is TerminalSessionState.Resizing -> "resizing"
    is TerminalSessionState.Exited -> "exited: ${terminalReasonLabel(state.reason)}"
    is TerminalSessionState.Failed -> "failed: ${terminalReasonLabel(state.reason)}"
    is TerminalSessionState.Disconnected -> "disconnected: ${terminalReasonWithDetail(state.reason, state.message)}"
}

internal fun terminalDisplayText(state: TerminalSessionState): String {
    val viewport = terminalViewportText(state)
    val banner = terminalSessionBannerMessage(state) ?: return viewport
    return if (viewport.isBlank()) banner else "$viewport\n$banner"
}

private fun terminalDisconnectedMessage(reason: TerminalDisconnectedReason, detail: String? = null): String =
    "Terminal disconnected: ${terminalReasonWithDetail(reason, detail)}. Reconnect or return to diagnostics."

private fun terminalReasonWithDetail(reason: TerminalDisconnectedReason, detail: String? = null): String {
    val cleanDetail = detail
        ?.trim()
        ?.takeIf { it.isNotBlank() && it != "disconnected" }
    return listOfNotNull(terminalReasonLabel(reason), cleanDetail).joinToString(" - ")
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

internal fun terminalSessionDisplayName(index: Int): String = "terminal-${index + 1}"

internal fun terminalSessionDisplayName(
    session: TerminalSessionRecord,
    fallbackIndex: Int,
): String = session.displayName.ifBlank { terminalSessionDisplayName(fallbackIndex) }

internal fun terminalScreenTitle(
    sessionId: String?,
    sessions: List<TerminalSessionRecord>,
    hostId: String,
    remotePath: String,
): String {
    return terminalScreenTitle(
        sessionId = sessionId,
        sessions = sessions,
        hostIds = setOf(hostId),
        remotePath = remotePath,
    )
}

internal fun terminalScreenTitle(
    sessionId: String?,
    sessions: List<TerminalSessionRecord>,
    hostIds: Set<String>,
    remotePath: String,
): String {
    val path = terminalSessionRemotePath(remotePath)
    val workspaceSessions = terminalWorkspaceCreatedSessions(
        sessions = sessions,
        hostIds = hostIds,
        remotePath = path,
    )
    val index = workspaceSessions.indexOfFirst { it.id == sessionId }.takeIf { it >= 0 } ?: 0
    val activeSession = workspaceSessions.firstOrNull { it.id == sessionId }
    val label = activeSession?.let { terminalSessionDisplayName(it, index) } ?: terminalSessionDisplayName(index)
    return "$label $path"
}
