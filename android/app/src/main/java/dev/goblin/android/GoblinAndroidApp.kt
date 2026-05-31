package dev.goblin.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.RemoteRepositoryStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.navigation.AppRoute
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshInitializationService
import dev.goblin.android.terminal.TerminalSessionFactory
import dev.goblin.android.ui.screens.addhost.AddHostScreen
import dev.goblin.android.ui.screens.diagnostics.DiagnosticsScreen
import dev.goblin.android.ui.screens.hosts.HostsScreen
import dev.goblin.android.ui.screens.placeholders.SettingsPlaceholderScreen
import dev.goblin.android.ui.screens.terminal.TerminalScreen

@Composable
fun GoblinAndroidApp(
    hostProfileStore: HostProfileStore,
    remoteRepositoryStore: RemoteRepositoryStore,
    secureIdentityStore: SecureIdentityStore,
    diagnosticsService: SshDiagnosticsService,
    initializationService: SshInitializationService,
    terminalService: TerminalSessionFactory,
) {
    var route: AppRoute by remember { mutableStateOf(AppRoute.Hosts) }
    var hostsState: ResourceState<List<SshHostProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(hostProfileStore.loadHosts()))
    }
    var repositoriesState: ResourceState<List<RemoteRepositoryProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(remoteRepositoryStore.loadRepositories()))
    }

    fun reloadHosts() {
        hostsState = ResourceState.Loaded(hostProfileStore.loadHosts())
    }

    fun reloadRepositories() {
        repositoriesState = ResourceState.Loaded(remoteRepositoryStore.loadRepositories())
    }

    fun currentHosts(): List<SshHostProfile> = when (val state = hostsState) {
        is ResourceState.Loaded -> state.value
        is ResourceState.Stale -> state.value
        else -> hostProfileStore.loadHosts()
    }

    fun currentRepositories(): List<RemoteRepositoryProfile> = when (val state = repositoriesState) {
        is ResourceState.Loaded -> state.value
        is ResourceState.Stale -> state.value
        else -> remoteRepositoryStore.loadRepositories()
    }

    when (val currentRoute = route) {
        AppRoute.Hosts -> HostsScreen(
            hostsState = hostsState,
            onAddHost = { route = AppRoute.AddHost },
            onEditHost = { hostId -> route = AppRoute.EditHost(hostId) },
            onDeleteHost = { hostId ->
                hostProfileStore.deleteHost(hostId)
                remoteRepositoryStore.deleteByHostId(hostId)
                reloadHosts()
                reloadRepositories()
            },
            onOpenDiagnostics = { hostId -> route = AppRoute.Diagnostics(hostId) },
            onOpenSettings = { route = AppRoute.Settings },
        )

        AppRoute.AddHost -> AddHostScreen(
            initialHost = null,
            onBack = { route = AppRoute.Hosts },
            onImportPrivateKey = { displayName, bytes -> secureIdentityStore.importPrivateKey(displayName, bytes) },
            onSaveHost = { input ->
                hostProfileStore.saveHost(input)
                reloadHosts()
                route = AppRoute.Hosts
            },
        )

        is AppRoute.EditHost -> {
            val host = currentHosts().firstOrNull { it.id == currentRoute.hostId }
            if (host == null) {
                route = AppRoute.Hosts
            } else {
                AddHostScreen(
                    initialHost = host,
                    onBack = { route = AppRoute.Hosts },
                    onImportPrivateKey = { displayName, bytes -> secureIdentityStore.importPrivateKey(displayName, bytes) },
                    onSaveHost = { input ->
                        hostProfileStore.saveHost(input)
                        reloadHosts()
                        route = AppRoute.Hosts
                    },
                )
            }
        }

        is AppRoute.Diagnostics -> {
            val host = currentHosts().firstOrNull { it.id == currentRoute.hostId }
            if (host == null) {
                route = AppRoute.Hosts
            } else {
                val repositories = currentRepositories().filter { it.hostProfileId == host.id }
                fun routeHost(): SshHostProfile =
                    currentHosts().firstOrNull { it.id == currentRoute.hostId } ?: host

                DiagnosticsScreen(
                    host = host,
                    repositories = repositories,
                    onBack = { route = AppRoute.Hosts },
                    onOpenTerminal = { route = AppRoute.Terminal(currentRoute.hostId) },
                    onCheckSshInitialization = { initializationService.check(routeHost()) },
                    onInitializeSshAccess = { password ->
                        val result = initializationService.initialize(routeHost(), password)
                        hostProfileStore.saveHost(result.profile)
                        reloadHosts()
                    },
                    onRunDiagnostics = { diagnosticsService.runDiagnostics(RemoteTarget.fromHostProfile(routeHost())) },
                    onTrustHostKey = { fingerprint ->
                        initializationService.trustHostKey(routeHost(), fingerprint)
                    },
                    onSaveRepository = { repository ->
                        remoteRepositoryStore.saveRepository(repository)
                        reloadRepositories()
                    },
                    onDeleteRepository = { repositoryId ->
                        remoteRepositoryStore.deleteRepository(repositoryId)
                        reloadRepositories()
                    },
                )
            }
        }

        is AppRoute.Terminal -> {
            val host = currentHosts().firstOrNull { it.id == currentRoute.hostId }
            if (host == null) {
                route = AppRoute.Hosts
            } else {
                TerminalScreen(
                    host = host,
                    terminalService = terminalService,
                    onBack = { route = AppRoute.Diagnostics(currentRoute.hostId) },
                )
            }
        }

        AppRoute.Settings -> SettingsPlaceholderScreen(onBack = { route = AppRoute.Hosts })
    }
}
