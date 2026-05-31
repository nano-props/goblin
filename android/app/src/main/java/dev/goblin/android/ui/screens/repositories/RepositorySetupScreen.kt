package dev.goblin.android.ui.screens.repositories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteDirectoryEntry
import dev.goblin.android.domain.ssh.RemoteRepositoryBranch
import dev.goblin.android.domain.ssh.RemoteRepositoryCommit
import dev.goblin.android.domain.ssh.RemoteRepositoryInspection
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteRepositorySnapshot
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal enum class RepositoryWorkspaceTab(val label: String) {
    Status("Status"),
    Branches("Branches"),
    Commits("Commits"),
    Worktrees("Worktrees"),
    Terminal("Terminal"),
}

internal fun authenticatedHosts(hosts: List<SshHostProfile>): List<SshHostProfile> =
    hosts.filter { it.identityRefId != null }

internal fun defaultAuthenticatedHost(hosts: List<SshHostProfile>): SshHostProfile? =
    authenticatedHosts(hosts).firstOrNull()

internal fun canSaveRepository(host: SshHostProfile?, remotePath: String): Boolean =
    host?.identityRefId != null && remotePath.trim().startsWith("/")

internal fun repositoryWorkspaceTabs(repository: RemoteRepositoryProfile): List<RepositoryWorkspaceTab> =
    if (repository.remotePath.startsWith("/")) RepositoryWorkspaceTab.entries else emptyList()

internal fun repositoryTerminalPath(repository: RemoteRepositoryProfile): String = repository.remotePath

internal fun repositoriesAfterLocalDelete(
    repositories: List<RemoteRepositoryProfile>,
    repositoryId: String,
): List<RemoteRepositoryProfile> = repositories.filterNot { it.id == repositoryId }

internal fun createRepositoryFromInspection(
    host: SshHostProfile,
    alias: String,
    inspection: RemoteRepositoryInspection,
): RemoteRepositoryProfile = RemoteRepositoryProfile.create(
    hostProfileId = host.id,
    alias = alias,
    remotePath = inspection.topLevel,
)

internal fun repositorySnapshotStateAfterRefreshFailure(
    previous: ResourceState<RemoteRepositorySnapshot>,
    message: String,
    cause: Throwable? = null,
): ResourceState<RemoteRepositorySnapshot> = when (previous) {
    is ResourceState.Loaded -> ResourceState.Stale(previous.value, previous.loadedAtMillis, message)
    is ResourceState.Stale -> ResourceState.Stale(previous.value, previous.loadedAtMillis, message)
    else -> ResourceState.Error(message, cause)
}

internal fun worktreeBadges(worktree: RemoteRepositoryWorktree): List<String> =
    buildList {
        if (worktree.isPrimary) add("primary")
        if (worktree.isLinked) add("linked")
        if (worktree.isLocked) add("locked")
        if (worktree.isMissing) add("missing")
        if (worktree.isDirty) add("dirty ${worktree.changeCount}")
        if (worktree.isBare) add("bare")
    }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepositorySetupScreen(
    hosts: List<SshHostProfile>,
    repositories: List<RemoteRepositoryProfile>,
    onBack: () -> Unit,
    onSaveRepository: (RemoteRepositoryProfile) -> Unit,
    onOpenRepository: (String) -> Unit,
    onDeleteRepository: (String) -> Unit,
    onBrowseDirectories: (SshHostProfile, String) -> List<RemoteDirectoryEntry> = { _, _ -> emptyList() },
    onInspectRepository: (SshHostProfile, String) -> RemoteRepositoryInspection = { _, path ->
        RemoteRepositoryInspection(path, path, null, null)
    },
) {
    val authenticated = authenticatedHosts(hosts)
    var selectedHostId by remember(authenticated) { mutableStateOf(defaultAuthenticatedHost(authenticated)?.id) }
    var menuExpanded by remember { mutableStateOf(false) }
    var alias by remember { mutableStateOf("") }
    var remotePath by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var deleteTarget by remember { mutableStateOf<RemoteRepositoryProfile?>(null) }
    var browseState: ResourceState<List<RemoteDirectoryEntry>> by remember { mutableStateOf(ResourceState.Idle) }
    var saving by remember { mutableStateOf(false) }
    val selectedHost = authenticated.firstOrNull { it.id == selectedHostId }
    val scope = rememberCoroutineScope()

    fun browseDirectories() {
        val host = selectedHost ?: return
        val path = remotePath.trim().ifBlank { "/" }
        browseState = ResourceState.Loading
        error = null
        scope.launch {
            browseState = runCatching {
                withContext(Dispatchers.IO) { onBrowseDirectories(host, path) }
            }.fold(
                onSuccess = { ResourceState.Loaded(it) },
                onFailure = { ResourceState.Error(it.message ?: "Remote directory browse failed", it) },
            )
        }
    }

    fun validateAndSaveRepository() {
        val host = selectedHost ?: return
        saving = true
        error = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val inspection = onInspectRepository(host, remotePath)
                    createRepositoryFromInspection(host, alias, inspection)
                }
            }.onSuccess {
                onSaveRepository(it)
                alias = ""
                remotePath = ""
                browseState = ResourceState.Idle
                error = null
            }.onFailure {
                error = it.message ?: "Repository validation failed"
            }
            saving = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add project") },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("Back")
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
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md),
        ) {
            if (authenticated.isEmpty()) {
                Text("Initialize SSH access on a server before adding projects.")
                return@Column
            }

            Card(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(GoblinSpacing.Md),
                    verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                ) {
                    Text("Project source", style = MaterialTheme.typography.titleMedium)
                    Box {
                        OutlinedButton(onClick = { menuExpanded = true }) {
                            Text(selectedHost?.title ?: "Select server")
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            authenticated.forEach { host ->
                                DropdownMenuItem(
                                    text = { Text(host.title) },
                                    onClick = {
                                        selectedHostId = host.id
                                        menuExpanded = false
                                    },
                                )
                            }
                        }
                    }
                    OutlinedTextField(
                        modifier = Modifier.fillMaxWidth(),
                        value = alias,
                        onValueChange = { alias = it },
                        label = { Text("Alias") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        modifier = Modifier.fillMaxWidth(),
                        value = remotePath,
                        onValueChange = { remotePath = it },
                        label = { Text("Remote path") },
                        singleLine = true,
                        isError = error != null,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                        OutlinedButton(
                            enabled = selectedHost != null,
                            onClick = { browseDirectories() },
                        ) {
                            Text("Browse")
                        }
                    }
                    when (val state = browseState) {
                        ResourceState.Idle -> Unit
                        ResourceState.Loading -> Text("Loading directories.")
                        is ResourceState.Error -> Text(state.message, color = MaterialTheme.colorScheme.error)
                        is ResourceState.Stale -> DirectoryEntries(entries = state.value, onSelect = { remotePath = it.path })
                        is ResourceState.Loaded -> DirectoryEntries(entries = state.value, onSelect = { remotePath = it.path })
                    }
                    Button(
                        enabled = canSaveRepository(selectedHost, remotePath) && !saving,
                        onClick = { validateAndSaveRepository() },
                    ) {
                        Text(if (saving) "Validating..." else "Save project")
                    }
                    if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                }
            }

            Text("Saved projects", style = MaterialTheme.typography.titleMedium)
            if (repositories.isEmpty()) {
                Text("No saved projects.")
            } else {
                repositories.forEach { repository ->
                    RepositoryRow(
                        repository = repository,
                        onOpenRepository = onOpenRepository,
                        onDeleteRepository = { deleteTarget = repository },
                    )
                }
            }
        }
    }

    deleteTarget?.let { target ->
        DeleteRepositoryDialog(
            repository = target,
            onConfirm = {
                onDeleteRepository(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }
}

@Composable
private fun DirectoryEntries(
    entries: List<RemoteDirectoryEntry>,
    onSelect: (RemoteDirectoryEntry) -> Unit,
) {
    if (entries.isEmpty()) {
        Text("No child directories.")
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
        entries.forEach { entry ->
            TextButton(onClick = { onSelect(entry) }) {
                Text(entry.name)
            }
        }
    }
}

@Composable
private fun RepositoryRow(
    repository: RemoteRepositoryProfile,
    onOpenRepository: (String) -> Unit,
    onDeleteRepository: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f)) {
                Text(repository.title, style = MaterialTheme.typography.bodyMedium)
                Text(repository.remotePath, style = MaterialTheme.typography.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                TextButton(onClick = { onOpenRepository(repository.id) }) {
                    Text("Open")
                }
                TextButton(onClick = onDeleteRepository) {
                    Text("Delete")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RepositoryWorkspaceScreen(
    host: SshHostProfile,
    repository: RemoteRepositoryProfile,
    onBack: () -> Unit,
    onLoadSnapshot: () -> RemoteRepositorySnapshot,
    onOpenTerminalAtPath: (String) -> Unit,
    onDeleteRepository: () -> Unit,
) {
    var selectedTab by remember(repository.id) { mutableStateOf(RepositoryWorkspaceTab.Status) }
    var snapshotState: ResourceState<RemoteRepositorySnapshot> by remember(repository.id) {
        mutableStateOf(ResourceState.Idle)
    }
    var confirmDelete by remember(repository.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refreshSnapshot() {
        val previous = snapshotState
        snapshotState = ResourceState.Loading
        scope.launch {
            snapshotState = runCatching {
                withContext(Dispatchers.IO) { onLoadSnapshot() }
            }.fold(
                onSuccess = { ResourceState.Loaded(it) },
                onFailure = {
                    repositorySnapshotStateAfterRefreshFailure(
                        previous = previous,
                        message = it.message ?: "Repository snapshot failed",
                        cause = it,
                    )
                },
            )
        }
    }

    LaunchedEffect(repository.id) {
        refreshSnapshot()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(repository.title) },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(host.subtitle, style = MaterialTheme.typography.bodyMedium)
                    Text(repository.remotePath, style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                    TextButton(onClick = { refreshSnapshot() }) {
                        Text("Refresh")
                    }
                    TextButton(onClick = { confirmDelete = true }) {
                        Text("Delete")
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                repositoryWorkspaceTabs(repository).forEach { tab ->
                    TextButton(onClick = { selectedTab = tab }) {
                        Text(tab.label)
                    }
                }
            }
            when (selectedTab) {
                RepositoryWorkspaceTab.Status -> RepositoryStatusPanel(
                    repository = repository,
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                )

                RepositoryWorkspaceTab.Branches -> RepositoryBranchesPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onOpenTerminalAtPath = onOpenTerminalAtPath,
                )

                RepositoryWorkspaceTab.Commits -> RepositoryCommitsPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                )

                RepositoryWorkspaceTab.Worktrees -> RepositoryWorktreesPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onOpenTerminalAtPath = onOpenTerminalAtPath,
                )

                RepositoryWorkspaceTab.Terminal -> RepositoryTerminalPanel(
                    path = repositoryTerminalPath(repository),
                    onOpenTerminalAtPath = onOpenTerminalAtPath,
                )
            }
        }
    }

    if (confirmDelete) {
        DeleteRepositoryDialog(
            repository = repository,
            onConfirm = {
                onDeleteRepository()
                confirmDelete = false
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun DeleteRepositoryDialog(
    repository: RemoteRepositoryProfile,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete project record?") },
        text = {
            Text("This removes ${repository.title} from Goblin Android. It does not delete anything on the SSH server.")
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Delete")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun RepositoryStatusPanel(
    repository: RemoteRepositoryProfile,
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text("Status", style = MaterialTheme.typography.titleMedium)
                Text(snapshot.currentRef ?: repository.remotePath, style = MaterialTheme.typography.bodySmall)
                snapshot.defaultBranch?.let {
                    Text("default $it", style = MaterialTheme.typography.labelMedium)
                }
                if (snapshot.statusLines.isEmpty()) {
                    Text("Working tree clean.")
                } else {
                    Text("${snapshot.statusChangeCount} changes", style = MaterialTheme.typography.labelMedium)
                    snapshot.statusLines.forEach { line ->
                        Text(line, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun RepositoryBranchesPanel(
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
    onOpenTerminalAtPath: (String) -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            if (snapshot.branches.isEmpty()) {
                Text("No branches found.")
            } else {
                snapshot.branches.forEach { branch ->
                    BranchRow(
                        branch = branch,
                        onOpenTerminalAtPath = onOpenTerminalAtPath,
                    )
                }
            }
        }
    }
}

@Composable
private fun BranchRow(
    branch: RemoteRepositoryBranch,
    onOpenTerminalAtPath: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                Text(branch.name, style = MaterialTheme.typography.bodyMedium)
                Text(branch.worktreePath ?: "no worktree", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                    if (branch.isCurrent) Text("current", style = MaterialTheme.typography.labelMedium)
                    if (branch.isDefault) Text("default", style = MaterialTheme.typography.labelMedium)
                }
            }
            branch.worktreePath?.let { path ->
                TextButton(onClick = { onOpenTerminalAtPath(path) }) {
                    Text("Terminal")
                }
            }
        }
    }
}

@Composable
private fun RepositoryCommitsPanel(
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            if (snapshot.commits.isEmpty()) {
                Text("No commits found.")
            } else {
                snapshot.commits.forEach { commit ->
                    CommitRow(commit = commit)
                }
            }
        }
    }
}

@Composable
private fun CommitRow(commit: RemoteRepositoryCommit) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            Text(commit.subject, style = MaterialTheme.typography.bodyMedium)
            Text(
                listOfNotNull(commit.shortHash, commit.authorName, commit.relativeDate).joinToString(" - "),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun RepositoryWorktreesPanel(
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
    onOpenTerminalAtPath: (String) -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            if (snapshot.worktrees.isEmpty()) {
                Text("No worktrees found.")
            } else {
                snapshot.worktrees.forEach { worktree ->
                    WorktreeRow(
                        worktree = worktree,
                        onOpenTerminalAtPath = onOpenTerminalAtPath,
                    )
                }
            }
        }
    }
}

@Composable
private fun WorktreeRow(
    worktree: RemoteRepositoryWorktree,
    onOpenTerminalAtPath: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                Text(worktree.path, style = MaterialTheme.typography.bodyMedium)
                Text(worktree.branch ?: "detached", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                    worktreeBadges(worktree).forEach { badge ->
                        Text(badge, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            TextButton(onClick = { onOpenTerminalAtPath(worktree.path) }) {
                Text("Terminal")
            }
        }
    }
}

@Composable
private fun RepositoryTerminalPanel(
    path: String,
    onOpenTerminalAtPath: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
        ) {
            Text("Terminal", style = MaterialTheme.typography.titleMedium)
            Text(path)
            Button(onClick = { onOpenTerminalAtPath(path) }) {
                Text("Open terminal")
            }
        }
    }
}

@Composable
private fun SnapshotContent(
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
    content: @Composable (RemoteRepositorySnapshot) -> Unit,
) {
    when (snapshotState) {
        ResourceState.Idle,
        ResourceState.Loading,
        -> Text("Loading repository data.")

        is ResourceState.Error -> Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text("failed", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                Text(snapshotState.message)
                Button(onClick = onRefresh) {
                    Text("Retry")
                }
            }
        }

        is ResourceState.Stale -> {
            Text("stale - ${snapshotState.reason}", color = MaterialTheme.colorScheme.error)
            content(snapshotState.value)
        }
        is ResourceState.Loaded -> content(snapshotState.value)
    }
}
