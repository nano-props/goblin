package dev.goblin.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.ssh.HostKeyStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.navigation.AppRoute
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.terminal.TerminalSessionFactory
import dev.goblin.android.ui.screens.addhost.AddHostScreen
import dev.goblin.android.ui.screens.diagnostics.DiagnosticsScreen
import dev.goblin.android.ui.screens.hosts.HostsScreen
import dev.goblin.android.ui.screens.placeholders.SettingsPlaceholderScreen
import dev.goblin.android.ui.screens.terminal.TerminalScreen

@Composable
fun GoblinAndroidApp(
    hostProfileStore: HostProfileStore,
    secureIdentityStore: SecureIdentityStore,
    hostKeyStore: HostKeyStore,
    diagnosticsService: SshDiagnosticsService,
    terminalService: TerminalSessionFactory,
) {
    var route: AppRoute by remember { mutableStateOf(AppRoute.Hosts) }
    var hostsState: ResourceState<List<SshHostProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(hostProfileStore.loadHosts()))
    }

    fun reloadHosts() {
        hostsState = ResourceState.Loaded(hostProfileStore.loadHosts())
    }

    when (val currentRoute = route) {
        AppRoute.Hosts -> HostsScreen(
            hostsState = hostsState,
            onAddHost = { route = AppRoute.AddHost },
            onOpenDiagnostics = { hostId -> route = AppRoute.Diagnostics(hostId) },
            onOpenSettings = { route = AppRoute.Settings },
        )

        AppRoute.AddHost -> AddHostScreen(
            onBack = { route = AppRoute.Hosts },
            onImportPrivateKey = { displayName, bytes -> secureIdentityStore.importPrivateKey(displayName, bytes) },
            onSaveHost = { input ->
                hostProfileStore.saveHost(input)
                reloadHosts()
                route = AppRoute.Hosts
            },
        )

        is AppRoute.Diagnostics -> {
            val hosts = when (val state = hostsState) {
                is ResourceState.Loaded -> state.value
                is ResourceState.Stale -> state.value
                else -> hostProfileStore.loadHosts()
            }
            val host = hosts.firstOrNull { it.id == currentRoute.hostId }
            if (host == null) {
                route = AppRoute.Hosts
            } else {
                DiagnosticsScreen(
                    host = host,
                    onBack = { route = AppRoute.Hosts },
                    onOpenTerminal = { route = AppRoute.Terminal(currentRoute.hostId) },
                    onRunDiagnostics = { diagnosticsService.runDiagnostics(RemoteTarget.fromHostProfile(host)) },
                    onTrustHostKey = { fingerprint ->
                        hostKeyStore.trust(RemoteTarget.fromHostProfile(host), fingerprint)
                    },
                )
            }
        }

        is AppRoute.Terminal -> {
            val hosts = when (val state = hostsState) {
                is ResourceState.Loaded -> state.value
                is ResourceState.Stale -> state.value
                else -> hostProfileStore.loadHosts()
            }
            val host = hosts.firstOrNull { it.id == currentRoute.hostId }
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
