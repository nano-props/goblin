package dev.goblin.android.terminal

data class TerminalRendererDecision(
    val selectedRenderer: String = "Compose native text viewport",
    val fallbackAllowedOnlyAfterNativeFailure: Boolean = true,
)

