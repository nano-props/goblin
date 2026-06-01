package dev.goblin.android.navigation

import dev.goblin.android.terminal.TerminalSessionRecord

sealed interface AppRoute {
    data object Hosts : AppRoute
    data object Projects : AppRoute
    data object AddHost : AppRoute
    data object AddRepository : AppRoute
    data object Settings : AppRoute
    data class EditHost(val hostId: String) : AppRoute
    data class Diagnostics(val hostId: String) : AppRoute
    data class Repository(
        val repositoryId: String,
        val terminalWorkspacePath: String? = null,
    ) : AppRoute
    data class Terminal(
        val hostId: String,
        val remotePath: String = "/",
        val repositoryId: String? = null,
        val terminalSessionId: String? = null,
    ) : AppRoute

    companion object {
        fun terminal(session: TerminalSessionRecord): Terminal =
            Terminal(
                hostId = session.hostId,
                remotePath = session.remotePath,
                repositoryId = session.repositoryId,
                terminalSessionId = session.id,
            )
    }
}
