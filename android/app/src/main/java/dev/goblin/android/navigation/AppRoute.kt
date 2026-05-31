package dev.goblin.android.navigation

sealed interface AppRoute {
    data object Hosts : AppRoute
    data object AddHost : AppRoute
    data object AddRepository : AppRoute
    data object Settings : AppRoute
    data class EditHost(val hostId: String) : AppRoute
    data class Diagnostics(val hostId: String) : AppRoute
    data class Repository(val repositoryId: String) : AppRoute
    data class Terminal(
        val hostId: String,
        val remotePath: String = "/",
        val repositoryId: String? = null,
    ) : AppRoute
}
