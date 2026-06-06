package dev.goblin.android.ui.screens.projects

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
import androidx.compose.ui.text.font.FontWeight
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ui.theme.GoblinSpacing

@Composable
fun ProjectsScreen(
    repositoriesState: ResourceState<List<RemoteRepositoryProfile>>,
    hosts: List<SshHostProfile>,
    onOpenProject: (String) -> Unit,
    onDeleteProject: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(GoblinSpacing.Md),
    ) {
        when (repositoriesState) {
            ResourceState.Idle,
            ResourceState.Loading,
            -> LoadingProjects()

            is ResourceState.Error -> ErrorProjects(message = repositoriesState.message)
            is ResourceState.Stale -> ProjectList(
                repositories = repositoriesState.value,
                hosts = hosts,
                onOpenProject = onOpenProject,
                onDeleteProject = onDeleteProject,
            )
            is ResourceState.Loaded -> ProjectList(
                repositories = repositoriesState.value,
                hosts = hosts,
                onOpenProject = onOpenProject,
                onDeleteProject = onDeleteProject,
            )
        }
    }
}

@Composable
private fun ProjectList(
    repositories: List<RemoteRepositoryProfile>,
    hosts: List<SshHostProfile>,
    onOpenProject: (String) -> Unit,
    onDeleteProject: (String) -> Unit,
) {
    var deleteTarget by remember { mutableStateOf<RemoteRepositoryProfile?>(null) }
    val hostById = remember(hosts) { hosts.associateBy { it.id } }

    if (repositories.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("No projects", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(GoblinSpacing.Sm))
            Text("Add a remote Git project to open its workspace, terminal, and port forwards.")
            Spacer(Modifier.height(GoblinSpacing.Lg))
        }
        return
    }

    Text("Saved projects", style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(GoblinSpacing.Md))
    LazyColumn(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            items(repositories, key = { it.id }) { repository ->
                ProjectRow(
                    repository = repository,
                    host = hostById[repository.hostProfileId],
                    onOpenProject = { onOpenProject(repository.id) },
                    onDeleteProject = { deleteTarget = repository },
                )
            }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete project record?") },
            text = { Text("This removes ${target.title} from Goblin Android. It does not delete anything on the SSH server.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteProject(target.id)
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
            }
        )
    }
}

@Composable
private fun LoadingProjects() {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        Text("loading", style = MaterialTheme.typography.labelMedium)
        Text("Loading saved projects.")
    }
}

@Composable
private fun ErrorProjects(message: String) {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md)) {
        Text("error", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
        Text(message)
    }
}

@Composable
private fun ProjectRow(
    repository: RemoteRepositoryProfile,
    host: SshHostProfile?,
    onOpenProject: () -> Unit,
    onDeleteProject: () -> Unit,
) {
    val rootAddress = remember(host?.host) {
        host?.let { "root@${it.host}:${it.port}" }
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onOpenProject,
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
                Text("${repository.title}: ${repository.remotePath}", style = MaterialTheme.typography.bodySmall)
                rootAddress?.let { address ->
                    Text(address, style = MaterialTheme.typography.labelMedium)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                TextButton(onClick = onOpenProject) {
                    Text("Open")
                }
                TextButton(onClick = onDeleteProject) {
                    Text("Delete")
                }
            }
        }
    }
}
