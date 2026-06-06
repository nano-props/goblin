package dev.goblin.android.terminals

data class TerminalRendererDecision(
    val selectedRenderer: String = "Compose native text viewport",
    val fallbackAllowedOnlyAfterNativeFailure: Boolean = true,
)

