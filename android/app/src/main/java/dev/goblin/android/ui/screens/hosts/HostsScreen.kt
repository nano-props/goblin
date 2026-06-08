package dev.goblin.android.ui.screens.hosts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.navigation.AppRoute
import dev.goblin.android.ui.theme.GoblinSpacing

internal const val HOST_TEMPORARY_TERMINAL_REMOTE_PATH = "/"

internal fun isHostTemporaryTerminal(remotePath: String, repositoryId: String?): Boolean =
    repositoryId == null && remotePath == HOST_TEMPORARY_TERMINAL_REMOTE_PATH

internal fun hostTemporaryTerminalRoute(hostId: String): AppRoute.Terminal =
    AppRoute.Terminal(hostId = hostId, remotePath = HOST_TEMPORARY_TERMINAL_REMOTE_PATH)

internal enum class HostHealth {
    Online,
    Offline,
}

internal fun hostHealth(host: SshHostProfile): HostHealth =
    when (host.lastDiagnosticStatus?.lowercase()) {
        "healthy" -> HostHealth.Online
        else -> HostHealth.Offline
    }

internal fun hostHealthLabel(health: HostHealth): String =
    when (health) {
        HostHealth.Online -> "online"
        HostHealth.Offline -> "offline"
    }

internal fun hostHealthIndicatorColor(health: HostHealth): Color =
    when (health) {
        HostHealth.Online -> Color(0xFF137333)
        HostHealth.Offline -> Color(0xFFC5221F)
    }

@Composable
fun HostsScreen(
    hostsState: ResourceState<List<SshHostProfile>>,
    onEditHost: (String) -> Unit,
    onDeleteHost: (String) -> Unit,
    onOpenDiagnostics: (String) -> Unit,
    onOpenTerminal: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(GoblinSpacing.Md),
    ) {
        when (hostsState) {
            ResourceState.Idle,
            ResourceState.Loading,
            -> LoadingHosts()

            is ResourceState.Error -> ErrorHosts(message = hostsState.message)
            is ResourceState.Stale -> HostList(
                hosts = hostsState.value,
                onEditHost = onEditHost,
                onDeleteHost = onDeleteHost,
                onOpenDiagnostics = onOpenDiagnostics,
                onOpenTerminal = onOpenTerminal,
            )
            is ResourceState.Loaded -> HostList(
                hosts = hostsState.value,
                onEditHost = onEditHost,
                onDeleteHost = onDeleteHost,
                onOpenDiagnostics = onOpenDiagnostics,
                onOpenTerminal = onOpenTerminal,
            )
        }
    }
}

@Composable
private fun LoadingHosts() {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        Text("loading", style = MaterialTheme.typography.labelMedium)
        Text("Loading saved SSH hosts.")
    }
}

@Composable
private fun ErrorHosts(message: String) {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md)) {
        Text("error", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
        Text(message)
    }
}

@Composable
private fun HostList(
    hosts: List<SshHostProfile>,
    onEditHost: (String) -> Unit,
    onDeleteHost: (String) -> Unit,
    onOpenDiagnostics: (String) -> Unit,
    onOpenTerminal: (String) -> Unit,
) {
    var deleteTarget by remember { mutableStateOf<SshHostProfile?>(null) }

    if (hosts.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("No SSH hosts", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(GoblinSpacing.Sm))
            Text("Add a remote development machine to start diagnostics and terminal access.")
            Spacer(Modifier.height(GoblinSpacing.Lg))
        }
        return
    }

    Text("Saved hosts", style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(GoblinSpacing.Md))
    LazyColumn(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        items(hosts, key = { it.id }) { host ->
            val health = hostHealth(host)
            HostRow(
                host = host,
                canOpenTerminal = health == HostHealth.Online,
                onOpenDiagnostics = { onOpenDiagnostics(host.id) },
                onOpenTerminal = { onOpenTerminal(host.id) },
                onEditHost = { onEditHost(host.id) },
                onDeleteHost = { deleteTarget = host },
            )
        }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete host profile?") },
            text = { Text("This removes ${target.title} from Goblin Android. It does not delete anything on the SSH server.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteHost(target.id)
                        deleteTarget = null
                    },
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun HostRow(
    host: SshHostProfile,
    canOpenTerminal: Boolean,
    onOpenDiagnostics: () -> Unit,
    onOpenTerminal: () -> Unit,
    onEditHost: () -> Unit,
    onDeleteHost: () -> Unit,
) {
    val health = hostHealth(host)
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onOpenDiagnostics,
    ) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            Text(host.title, style = MaterialTheme.typography.titleMedium)
            Text(host.subtitle, style = MaterialTheme.typography.bodyMedium)
            HostStatusIndicator(health)
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                TextButton(
                    enabled = canOpenTerminal,
                    onClick = onOpenTerminal,
                ) {
                    Text("Terminal")
                }
                TextButton(onClick = onEditHost) {
                    Text("Edit")
                }
                TextButton(onClick = onDeleteHost) {
                    Text("Delete")
                }
            }
        }
    }
}

@Composable
private fun HostStatusIndicator(health: HostHealth) {
    val label = hostHealthLabel(health)
    Row(
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(hostHealthIndicatorColor(health), CircleShape)
                .semantics { contentDescription = "Host status $label" },
        )
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}
