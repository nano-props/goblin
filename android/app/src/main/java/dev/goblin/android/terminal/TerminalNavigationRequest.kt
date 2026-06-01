package dev.goblin.android.terminal

data class TerminalNavigationRequest(
    val sessionId: String,
    val sequence: Long,
)
