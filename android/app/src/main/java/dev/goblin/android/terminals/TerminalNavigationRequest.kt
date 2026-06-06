package dev.goblin.android.terminals

data class TerminalNavigationRequest(
    val sessionId: String,
    val sequence: Long,
)
