package dev.goblin.android.terminals

const val TerminalSessionIntentExtra = "dev.goblin.android.extra.TERMINAL_SESSION_ID"

data class TerminalNotificationContent(
    val title: String,
    val text: String,
    val terminalSessionId: String?,
)

object TerminalNotificationFactory {
    const val NotificationId = 1001
    const val ChannelId = "terminal_sessions"
    const val ChannelName = "Terminal sessions"

    fun contentFor(sessions: List<TerminalSessionRecord>): TerminalNotificationContent {
        val running = sessions.filter { it.status == TerminalSessionStatus.Running }
        val first = firstRunningSession(running)
        val count = running.size
        val title = when (count) {
            0 -> "No terminals running"
            1 -> "1 terminal running"
            else -> "$count terminals running"
        }
        val text = first?.targetLabel ?: "No active terminal"
        return TerminalNotificationContent(
            title = title,
            text = text,
            terminalSessionId = first?.id,
        )
    }

    fun firstRunningSession(sessions: List<TerminalSessionRecord>): TerminalSessionRecord? =
        sessions
            .filter { it.status == TerminalSessionStatus.Running }
            .minByOrNull { it.openedAt }
}
