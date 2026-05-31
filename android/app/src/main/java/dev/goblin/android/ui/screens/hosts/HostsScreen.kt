package dev.goblin.android.ui.screens.hosts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ui.theme.GoblinSpacing

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostsScreen(
    hostsState: ResourceState<List<SshHostProfile>>,
    repositories: List<RemoteRepositoryProfile> = emptyList(),
    onAddHost: () -> Unit,
    onAddRepository: () -> Unit = {},
    onOpenRepository: (String) -> Unit = {},
    onDeleteRepository: (String) -> Unit = {},
    onEditHost: (String) -> Unit,
    onDeleteHost: (String) -> Unit,
    onOpenDiagnostics: (String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("SSH Hosts") },
                actions = {
                    TextButton(onClick = onOpenSettings) {
                        Text("Settings")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(GoblinSpacing.Md),
        ) {
            when (hostsState) {
                ResourceState.Idle,
                ResourceState.Loading,
                -> LoadingHosts()

                is ResourceState.Error -> ErrorHosts(message = hostsState.message, onAddHost = onAddHost)
                is ResourceState.Stale -> HostList(
                    hosts = hostsState.value,
                    repositories = repositories,
                    onAddHost = onAddHost,
                    onAddRepository = onAddRepository,
                    onOpenRepository = onOpenRepository,
                    onDeleteRepository = onDeleteRepository,
                    onEditHost = onEditHost,
                    onDeleteHost = onDeleteHost,
                    onOpenDiagnostics = onOpenDiagnostics,
                )
                is ResourceState.Loaded -> HostList(
                    hosts = hostsState.value,
                    repositories = repositories,
                    onAddHost = onAddHost,
                    onAddRepository = onAddRepository,
                    onOpenRepository = onOpenRepository,
                    onDeleteRepository = onDeleteRepository,
                    onEditHost = onEditHost,
                    onDeleteHost = onDeleteHost,
                    onOpenDiagnostics = onOpenDiagnostics,
                )
            }
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
private fun ErrorHosts(message: String, onAddHost: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md)) {
        Text("error", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
        Text(message)
        Button(onClick = onAddHost) {
            Text("Add host")
        }
    }
}

@Composable
private fun HostList(
    hosts: List<SshHostProfile>,
    repositories: List<RemoteRepositoryProfile>,
    onAddHost: () -> Unit,
    onAddRepository: () -> Unit,
    onOpenRepository: (String) -> Unit,
    onDeleteRepository: (String) -> Unit,
    onEditHost: (String) -> Unit,
    onDeleteHost: (String) -> Unit,
    onOpenDiagnostics: (String) -> Unit,
) {
    var deleteTarget by remember { mutableStateOf<SshHostProfile?>(null) }
    var repositoryDeleteTarget by remember { mutableStateOf<RemoteRepositoryProfile?>(null) }

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
            Button(
                modifier = Modifier.semantics { contentDescription = "Add host" },
                onClick = onAddHost,
            ) {
                Text("Add host")
            }
        }
        return
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Saved hosts", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            TextButton(onClick = onAddRepository) {
                Text("Add project")
            }
            Button(onClick = onAddHost) {
                Text("Add host")
            }
        }
    }
    Spacer(Modifier.height(GoblinSpacing.Md))
    LazyColumn(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        items(hosts, key = { it.id }) { host ->
            HostRow(
                host = host,
                onOpenDiagnostics = { onOpenDiagnostics(host.id) },
                onEditHost = { onEditHost(host.id) },
                onDeleteHost = { deleteTarget = host },
            )
        }
        if (repositories.isNotEmpty()) {
            item {
                Spacer(Modifier.height(GoblinSpacing.Sm))
                Text("Saved projects", style = MaterialTheme.typography.titleMedium)
            }
            items(repositories, key = { it.id }) { repository ->
                RepositoryRow(
                    repository = repository,
                    onOpenRepository = { onOpenRepository(repository.id) },
                    onDeleteRepository = { repositoryDeleteTarget = repository },
                )
            }
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

    repositoryDeleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { repositoryDeleteTarget = null },
            title = { Text("Delete project record?") },
            text = { Text("This removes ${target.title} from Goblin Android. It does not delete anything on the SSH server.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteRepository(target.id)
                        repositoryDeleteTarget = null
                    },
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { repositoryDeleteTarget = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun RepositoryRow(
    repository: RemoteRepositoryProfile,
    onOpenRepository: () -> Unit,
    onDeleteRepository: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onOpenRepository,
    ) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
            ) {
                Text(repository.title, style = MaterialTheme.typography.titleMedium)
                Text(repository.remotePath, style = MaterialTheme.typography.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                TextButton(onClick = onOpenRepository) {
                    Text("Open")
                }
                TextButton(onClick = onDeleteRepository) {
                    Text("Delete")
                }
            }
        }
    }
}

@Composable
private fun HostRow(
    host: SshHostProfile,
    onOpenDiagnostics: () -> Unit,
    onEditHost: () -> Unit,
    onDeleteHost: () -> Unit,
) {
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
            Text(host.lastDiagnosticStatus ?: "pending", style = MaterialTheme.typography.labelMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
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
