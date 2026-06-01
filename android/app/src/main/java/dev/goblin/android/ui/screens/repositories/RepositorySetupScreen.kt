package dev.goblin.android.ui.screens.repositories

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
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
import androidx.compose.ui.platform.LocalContext
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSession
import dev.goblin.android.domain.ssh.PortForwardSessionStatus
import dev.goblin.android.domain.ssh.canCreatePortForward
import dev.goblin.android.domain.ssh.RemoteDirectoryEntry
import dev.goblin.android.domain.ssh.RemoteRepositoryBranch
import dev.goblin.android.domain.ssh.RemoteRepositoryCommit
import dev.goblin.android.domain.ssh.RemoteRepositoryInspection
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteRepositorySnapshot
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ssh.evaluateWorktreeRemoval
import dev.goblin.android.ssh.worktreeRemovalConfirmationText
import dev.goblin.android.terminal.TerminalDisconnectedReason
import dev.goblin.android.terminal.TerminalSessionRecord
import dev.goblin.android.terminal.TerminalSessionStatus
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal enum class RepositoryWorkspaceTab(val label: String) {
    Status("Status"),
    Branches("Branches"),
    Commits("Commits"),
    Worktrees("Worktrees"),
    Ports("Ports"),
    Terminal("Terminal"),
}

private const val CompactWorkspaceTabLimit = 4

internal fun authenticatedHosts(hosts: List<SshHostProfile>): List<SshHostProfile> =
    hosts.filter { it.identityRefId != null }

internal fun defaultAuthenticatedHost(hosts: List<SshHostProfile>): SshHostProfile? =
    authenticatedHosts(hosts).firstOrNull()

internal fun canSaveRepository(host: SshHostProfile?, remotePath: String): Boolean =
    host?.identityRefId != null && remotePath.trim().startsWith("/")

internal fun repositoryWorkspaceTabs(repository: RemoteRepositoryProfile): List<RepositoryWorkspaceTab> =
    if (repository.remotePath.startsWith("/")) RepositoryWorkspaceTab.entries else emptyList()

internal fun repositoryWorkspaceTabsUseScrollableStrip(tabs: List<RepositoryWorkspaceTab>): Boolean =
    tabs.size > CompactWorkspaceTabLimit

internal fun repositoryWorkspaceTabIndex(
    tabs: List<RepositoryWorkspaceTab>,
    selectedTab: RepositoryWorkspaceTab,
    fallback: RepositoryWorkspaceTab = RepositoryWorkspaceTab.Status,
): Int {
    val selectedIndex = tabs.indexOf(selectedTab)
    if (selectedIndex >= 0) return selectedIndex
    return tabs.indexOf(fallback).coerceAtLeast(0)
}

internal fun repositoryTerminalPath(repository: RemoteRepositoryProfile): String = repository.remotePath

internal fun worktreeTerminalPath(worktree: RemoteRepositoryWorktree): String = worktree.path

internal fun suggestedWorktreePath(repositoryPath: String, branch: String): String {
    val parent = repositoryPath.trimEnd('/').substringBeforeLast("/", missingDelimiterValue = "")
    val repoName = repositoryPath.trimEnd('/').substringAfterLast("/")
    val safeBranch = branch.trim()
        .replace(Regex("[^A-Za-z0-9._-]+"), "-")
        .trim('-')
        .ifBlank { "worktree" }
    val base = if (parent.isBlank()) "/" else parent
    return "$base/$repoName-$safeBranch"
}

internal fun canCreateWorktree(branch: String, worktreePath: String): Boolean =
    branch.isNotBlank() && worktreePath.trim().startsWith("/")

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

internal fun portForwardOwner(repository: RemoteRepositoryProfile): PortForwardOwner =
    PortForwardOwner(id = repository.id, label = repository.title)

internal fun portForwardSessionsForRepository(
    sessions: List<PortForwardSession>,
    repositoryId: String,
): List<PortForwardSession> = sessions.filter { it.owner.id == repositoryId }

internal fun portForwardActionLabels(session: PortForwardSession): List<String> =
    if (session.status == PortForwardSessionStatus.Active && session.localUrl != null) {
        listOf("Open URL", "Copy URL", "Stop")
    } else {
        emptyList()
    }

internal fun portForwardLifecycleText(session: PortForwardSession): String = when (session.status) {
    PortForwardSessionStatus.Starting -> "starting tunnel"
    PortForwardSessionStatus.Active -> "active in this app session - stop it when the emergency task is done"
    PortForwardSessionStatus.Stopped -> "stopped"
    PortForwardSessionStatus.Failed -> session.message?.let { "failed - $it" } ?: "failed"
}

internal fun terminalWorkspaceSessions(
    sessions: List<TerminalSessionRecord>,
    repositoryId: String,
    remotePath: String,
): List<TerminalSessionRecord> =
    sessions
        .filter { it.repositoryId == repositoryId && it.remotePath == remotePath }
        .sortedWith(terminalWorkspaceSessionComparator)

internal fun terminalSessionDefaultLabel(index: Int): String = "Terminal ${index + 1}"

internal fun terminalSessionStatusLabel(session: TerminalSessionRecord): String {
    val base = when (session.status) {
        TerminalSessionStatus.Starting -> "starting"
        TerminalSessionStatus.Running -> "running"
        TerminalSessionStatus.Exited -> "exited"
        TerminalSessionStatus.Failed -> "failed"
        TerminalSessionStatus.Disconnected -> "disconnected"
    }
    if (session.status == TerminalSessionStatus.Running && session.foregroundServiceOwned) {
        return "$base - foreground"
    }
    val reason = session.disconnectedReason ?: return base
    return when (session.status) {
        TerminalSessionStatus.Exited,
        TerminalSessionStatus.Failed,
        TerminalSessionStatus.Disconnected,
        -> "$base - ${terminalDisconnectedReasonLabel(reason)}"
        TerminalSessionStatus.Starting,
        TerminalSessionStatus.Running,
        -> base
    }
}

private fun terminalDisconnectedReasonLabel(reason: TerminalDisconnectedReason): String =
    when (reason) {
        TerminalDisconnectedReason.UserClosed -> "user closed"
        TerminalDisconnectedReason.RemoteExited -> "remote exited"
        TerminalDisconnectedReason.SshDisconnected -> "ssh disconnected"
        TerminalDisconnectedReason.AndroidServiceStopped -> "android service stopped"
        TerminalDisconnectedReason.TerminalFailure -> "terminal failure"
    }

internal fun terminalSessionActivityText(session: TerminalSessionRecord): String =
    session.lastActivityAt?.let { "last activity $it" } ?: "opened ${session.openedAt}"

internal fun requiresTerminalDeleteConfirmation(session: TerminalSessionRecord): Boolean =
    session.status == TerminalSessionStatus.Starting || session.status == TerminalSessionStatus.Running

internal fun terminalDeleteConfirmationText(label: String, session: TerminalSessionRecord): String =
    "$label at ${session.remotePath} is still active. This will stop the terminal process and remove the terminal record."

private data class TerminalDeleteTarget(
    val session: TerminalSessionRecord,
    val label: String,
)

private fun TerminalSessionStatus.terminalWorkspacePriority(): Int =
    when (this) {
        TerminalSessionStatus.Starting,
        TerminalSessionStatus.Running,
        -> 0
        TerminalSessionStatus.Exited,
        TerminalSessionStatus.Failed,
        TerminalSessionStatus.Disconnected,
        -> 1
    }

private val terminalWorkspaceSessionComparator: Comparator<TerminalSessionRecord> =
    compareBy<TerminalSessionRecord> { it.status.terminalWorkspacePriority() }
        .thenByDescending { it.lastActivityAt ?: it.openedAt }
        .thenBy { it.openedAt }

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
    initialTerminalWorkspacePath: String? = null,
    terminalSessions: List<TerminalSessionRecord> = emptyList(),
    onCreateTerminalAtPath: (String) -> TerminalSessionRecord = {
        throw UnsupportedOperationException("Terminal sessions are not available")
    },
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit = {},
    onDeleteTerminalSession: (String) -> Unit = {},
    onDeleteRepository: () -> Unit,
    onCreateWorktree: (String, String) -> Unit = { _, _ -> },
    onRemoveWorktree: (RemoteRepositoryWorktree) -> Unit = {},
    portForwardSessions: List<PortForwardSession> = emptyList(),
    onStartPortForward: (PortForwardRequest) -> PortForwardSession = {
        throw UnsupportedOperationException("Port forwarding is not available")
    },
    onStopPortForward: (String) -> PortForwardSession? = { null },
) {
    var selectedTab by remember(repository.id) {
        mutableStateOf(
            if (initialTerminalWorkspacePath == null) {
                RepositoryWorkspaceTab.Status
            } else {
                RepositoryWorkspaceTab.Terminal
            },
        )
    }
    var selectedTerminalWorkspacePath by remember(repository.id) {
        mutableStateOf(initialTerminalWorkspacePath ?: repositoryTerminalPath(repository))
    }
    var snapshotState: ResourceState<RemoteRepositorySnapshot> by remember(repository.id) {
        mutableStateOf(ResourceState.Idle)
    }
    var visiblePortForwards by remember(repository.id) {
        mutableStateOf(portForwardSessionsForRepository(portForwardSessions, repository.id))
    }
    var confirmDelete by remember(repository.id) { mutableStateOf(false) }
    var removeTarget by remember(repository.id) { mutableStateOf<RemoteRepositoryWorktree?>(null) }
    var terminalDeleteTarget by remember(repository.id) { mutableStateOf<TerminalDeleteTarget?>(null) }
    var actionError by remember(repository.id) { mutableStateOf<String?>(null) }
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

    fun upsertPortForwardSession(session: PortForwardSession) {
        visiblePortForwards = portForwardSessionsForRepository(
            visiblePortForwards.filterNot { it.id == session.id } + session,
            repository.id,
        )
    }

    fun startPortForward(request: PortForwardRequest) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onStartPortForward(request) }
            }.onSuccess { session ->
                upsertPortForwardSession(session)
            }.onFailure {
                actionError = it.message ?: "Port forward failed"
            }
        }
    }

    fun stopPortForward(sessionId: String) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onStopPortForward(sessionId) }
            }.onSuccess { session ->
                if (session != null) upsertPortForwardSession(session)
            }.onFailure {
                actionError = it.message ?: "Stop port forward failed"
            }
        }
    }

    fun createWorktree(branch: String, worktreePath: String) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onCreateWorktree(branch, worktreePath) }
            }.onSuccess {
                refreshSnapshot()
            }.onFailure {
                actionError = it.message ?: "Remote worktree create failed"
            }
        }
    }

    fun removeWorktree(worktree: RemoteRepositoryWorktree) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onRemoveWorktree(worktree) }
            }.onSuccess {
                removeTarget = null
                refreshSnapshot()
            }.onFailure {
                actionError = it.message ?: "Remote worktree remove failed"
            }
        }
    }

    fun selectTerminalWorkspace(path: String) {
        selectedTerminalWorkspacePath = path
        selectedTab = RepositoryWorkspaceTab.Terminal
    }

    fun createTerminal(path: String) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onCreateTerminalAtPath(path) }
            }.onSuccess { session ->
                onOpenTerminalSession(session)
            }.onFailure {
                actionError = it.message ?: "Terminal create failed"
            }
        }
    }

    fun deleteTerminalSession(session: TerminalSessionRecord) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onDeleteTerminalSession(session.id) }
            }.onSuccess {
                terminalDeleteTarget = null
            }.onFailure {
                actionError = it.message ?: "Terminal delete failed"
            }
        }
    }

    fun requestDeleteTerminalSession(session: TerminalSessionRecord, label: String) {
        if (requiresTerminalDeleteConfirmation(session)) {
            terminalDeleteTarget = TerminalDeleteTarget(session = session, label = label)
        } else {
            deleteTerminalSession(session)
        }
    }

    LaunchedEffect(repository.id) {
        refreshSnapshot()
    }

    LaunchedEffect(repository.id, initialTerminalWorkspacePath) {
        initialTerminalWorkspacePath?.let { selectTerminalWorkspace(it) }
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
                    actionError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
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
            RepositoryWorkspaceTabStrip(
                tabs = repositoryWorkspaceTabs(repository),
                selectedTab = selectedTab,
                onSelectTab = { selectedTab = it },
            )
            when (selectedTab) {
                RepositoryWorkspaceTab.Status -> RepositoryStatusPanel(
                    repository = repository,
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                )

                RepositoryWorkspaceTab.Branches -> RepositoryBranchesPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onSelectTerminalWorkspace = ::selectTerminalWorkspace,
                )

                RepositoryWorkspaceTab.Commits -> RepositoryCommitsPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                )

                RepositoryWorkspaceTab.Worktrees -> RepositoryWorktreesPanel(
                    repository = repository,
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onSelectTerminalWorkspace = ::selectTerminalWorkspace,
                    onCreateWorktree = ::createWorktree,
                    onRemoveWorktree = { removeTarget = it },
                )

                RepositoryWorkspaceTab.Ports -> RepositoryPortsPanel(
                    repository = repository,
                    sessions = visiblePortForwards,
                    onStartPortForward = ::startPortForward,
                    onStopPortForward = ::stopPortForward,
                )

                RepositoryWorkspaceTab.Terminal -> RepositoryTerminalPanel(
                    repositoryId = repository.id,
                    path = selectedTerminalWorkspacePath,
                    sessions = terminalSessions,
                    onCreateTerminalAtPath = ::createTerminal,
                    onOpenTerminalSession = onOpenTerminalSession,
                    onDeleteTerminalSession = ::requestDeleteTerminalSession,
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

    removeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            title = { Text("Remove remote worktree?") },
            text = { Text(worktreeRemovalConfirmationText(target)) },
            confirmButton = {
                TextButton(onClick = { removeWorktree(target) }) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { removeTarget = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    terminalDeleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { terminalDeleteTarget = null },
            title = { Text("Delete running terminal?") },
            text = { Text(terminalDeleteConfirmationText(target.label, target.session)) },
            confirmButton = {
                TextButton(onClick = { deleteTerminalSession(target.session) }) {
                    Text("Stop and delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { terminalDeleteTarget = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun RepositoryWorkspaceTabStrip(
    tabs: List<RepositoryWorkspaceTab>,
    selectedTab: RepositoryWorkspaceTab,
    onSelectTab: (RepositoryWorkspaceTab) -> Unit,
) {
    if (tabs.isEmpty()) return
    if (repositoryWorkspaceTabsUseScrollableStrip(tabs)) {
        PrimaryScrollableTabRow(
            selectedTabIndex = repositoryWorkspaceTabIndex(tabs, selectedTab),
            edgePadding = GoblinSpacing.Xs,
        ) {
            tabs.forEach { tab ->
                Tab(
                    selected = tab == selectedTab,
                    onClick = { onSelectTab(tab) },
                    text = { Text(tab.label) },
                )
            }
        }
        return
    }

    Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        tabs.forEach { tab ->
            TextButton(onClick = { onSelectTab(tab) }) {
                Text(tab.label)
            }
        }
    }
}

@Composable
private fun RepositoryPortsPanel(
    repository: RemoteRepositoryProfile,
    sessions: List<PortForwardSession>,
    onStartPortForward: (PortForwardRequest) -> Unit,
    onStopPortForward: (String) -> Unit,
) {
    var remotePort by remember(repository.id) { mutableStateOf("") }
    var localPort by remember(repository.id) { mutableStateOf("") }
    var error by remember(repository.id) { mutableStateOf<String?>(null) }
    val context = LocalContext.current

    fun startForward() {
        runCatching {
            PortForwardRequest.fromInput(remotePort = remotePort, localPort = localPort)
        }.onSuccess { request ->
            error = null
            onStartPortForward(request)
        }.onFailure {
            error = it.message ?: "Invalid port forward"
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text("Forward service", style = MaterialTheme.typography.titleMedium)
                Text("Remote host defaults to 127.0.0.1. Tunnels are runtime sessions in this app.")
                OutlinedTextField(
                    modifier = Modifier.fillMaxWidth(),
                    value = remotePort,
                    onValueChange = { remotePort = it },
                    label = { Text("Remote port") },
                    singleLine = true,
                )
                OutlinedTextField(
                    modifier = Modifier.fillMaxWidth(),
                    value = localPort,
                    onValueChange = { localPort = it },
                    label = { Text("Local port (optional)") },
                    singleLine = true,
                )
                Button(
                    enabled = canCreatePortForward(remotePort = remotePort, localPort = localPort),
                    onClick = { startForward() },
                ) {
                    Text("Start tunnel")
                }
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        if (sessions.isEmpty()) {
            Text("No port forwards for this project.")
        } else {
            sessions.forEach { session ->
                PortForwardRow(
                    session = session,
                    onOpenUrl = { url -> openPortForwardUrl(context, url) },
                    onCopyUrl = { url -> copyPortForwardUrl(context, url) },
                    onStop = onStopPortForward,
                )
            }
        }
    }
}

@Composable
private fun PortForwardRow(
    session: PortForwardSession,
    onOpenUrl: (String) -> Unit,
    onCopyUrl: (String) -> Unit,
    onStop: (String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                Text("${session.request.remoteHost}:${session.request.remotePort}", style = MaterialTheme.typography.bodyMedium)
                Text(session.localUrl ?: "no local URL", style = MaterialTheme.typography.bodySmall)
                Text(portForwardLifecycleText(session), style = MaterialTheme.typography.labelMedium)
            }
            Column {
                if (session.status == PortForwardSessionStatus.Active) {
                    session.localUrl?.let { url ->
                        TextButton(onClick = { onOpenUrl(url) }) {
                            Text("Open URL")
                        }
                        TextButton(onClick = { onCopyUrl(url) }) {
                            Text("Copy URL")
                        }
                    }
                    TextButton(onClick = { onStop(session.id) }) {
                        Text("Stop")
                    }
                }
            }
        }
    }
}

private fun copyPortForwardUrl(context: Context, url: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Goblin port forward", url))
}

private fun openPortForwardUrl(context: Context, url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
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
    onSelectTerminalWorkspace: (String) -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            if (snapshot.branches.isEmpty()) {
                Text("No branches found.")
            } else {
                snapshot.branches.forEach { branch ->
                    BranchRow(
                        branch = branch,
                        onSelectTerminalWorkspace = onSelectTerminalWorkspace,
                    )
                }
            }
        }
    }
}

@Composable
private fun BranchRow(
    branch: RemoteRepositoryBranch,
    onSelectTerminalWorkspace: (String) -> Unit,
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
                TextButton(onClick = { onSelectTerminalWorkspace(path) }) {
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
    repository: RemoteRepositoryProfile,
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
    onSelectTerminalWorkspace: (String) -> Unit,
    onCreateWorktree: (String, String) -> Unit,
    onRemoveWorktree: (RemoteRepositoryWorktree) -> Unit,
) {
    var branch by remember(repository.id) { mutableStateOf("") }
    var worktreePath by remember(repository.id) { mutableStateOf("") }

    fun updateBranch(value: String) {
        branch = value
        worktreePath = suggestedWorktreePath(repository.remotePath, value)
    }

    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            Card(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(GoblinSpacing.Md),
                    verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                ) {
                    Text("Create worktree", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        modifier = Modifier.fillMaxWidth(),
                        value = branch,
                        onValueChange = { updateBranch(it) },
                        label = { Text("Base branch") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        modifier = Modifier.fillMaxWidth(),
                        value = worktreePath,
                        onValueChange = { worktreePath = it },
                        label = { Text("Worktree path") },
                        singleLine = true,
                    )
                    Button(
                        enabled = canCreateWorktree(branch, worktreePath),
                        onClick = { onCreateWorktree(branch, worktreePath) },
                    ) {
                        Text("Create worktree")
                    }
                }
            }
            if (snapshot.worktrees.isEmpty()) {
                Text("No worktrees found.")
            } else {
                snapshot.worktrees.forEach { worktree ->
                    WorktreeRow(
                        worktree = worktree,
                        onSelectTerminalWorkspace = onSelectTerminalWorkspace,
                        onRemoveWorktree = onRemoveWorktree,
                    )
                }
            }
        }
    }
}

@Composable
private fun WorktreeRow(
    worktree: RemoteRepositoryWorktree,
    onSelectTerminalWorkspace: (String) -> Unit,
    onRemoveWorktree: (RemoteRepositoryWorktree) -> Unit,
) {
    val removalSafety = evaluateWorktreeRemoval(worktree)
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
            Column {
                TextButton(onClick = { onSelectTerminalWorkspace(worktreeTerminalPath(worktree)) }) {
                    Text("Terminal")
                }
                if (removalSafety.allowed) {
                    TextButton(onClick = { onRemoveWorktree(worktree) }) {
                        Text("Remove")
                    }
                } else {
                    Text(removalSafety.reason.orEmpty(), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun RepositoryTerminalPanel(
    repositoryId: String,
    path: String,
    sessions: List<TerminalSessionRecord>,
    onCreateTerminalAtPath: (String) -> Unit,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
) {
    val workspaceSessions = terminalWorkspaceSessions(sessions, repositoryId, path)
    val openedOrderLabels = workspaceSessions
        .sortedBy { it.openedAt }
        .mapIndexed { index, session -> session.id to terminalSessionDefaultLabel(index) }
        .toMap()
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text("Terminal workspace", style = MaterialTheme.typography.titleMedium)
                Text(path)
                Button(onClick = { onCreateTerminalAtPath(path) }) {
                    Text("New terminal")
                }
            }
        }
        if (workspaceSessions.isEmpty()) {
            Text("No terminals for this worktree.")
        } else {
            workspaceSessions.forEach { session ->
                TerminalSessionRow(
                    session = session,
                    label = openedOrderLabels[session.id] ?: terminalSessionDefaultLabel(0),
                    onOpenTerminalSession = onOpenTerminalSession,
                    onDeleteTerminalSession = onDeleteTerminalSession,
                )
            }
        }
    }
}

@Composable
private fun TerminalSessionRow(
    session: TerminalSessionRecord,
    label: String,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(GoblinSpacing.Md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text(session.remotePath, style = MaterialTheme.typography.bodySmall)
                Text(terminalSessionStatusLabel(session), style = MaterialTheme.typography.labelMedium)
                Text(terminalSessionActivityText(session), style = MaterialTheme.typography.bodySmall)
            }
            Column {
                TextButton(onClick = { onOpenTerminalSession(session) }) {
                    Text("Open")
                }
                TextButton(onClick = { onDeleteTerminalSession(session, label) }) {
                    Text("Delete")
                }
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
