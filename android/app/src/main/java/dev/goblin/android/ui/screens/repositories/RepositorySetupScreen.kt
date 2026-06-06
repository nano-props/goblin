package dev.goblin.android.ui.screens.repositories

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteDirectoryEntry
import dev.goblin.android.domain.ssh.RemoteRepositoryBranch
import dev.goblin.android.domain.ssh.RemoteRepositoryInspection
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteRepositorySnapshot
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.evaluateWorktreeRemoval
import dev.goblin.android.ssh.worktreeRemovalConfirmationText
import dev.goblin.android.terminals.TerminalDisconnectedReason
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.ui.screens.terminals.terminalSessionRemotePath
import dev.goblin.android.ui.screens.terminals.terminalSessionDisplayName
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceSessionCountsByPath
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceCreatedSessions
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceOrderedSessions
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.absoluteValue
import kotlin.math.roundToInt

internal enum class RepositoryWorkspaceTab(val label: String) {
    Branches("Branches"),
    Worktrees("Worktrees"),
    Commits("Commits"),
    Ports("Ports"),
    Terminal("Terminals"),
}

private const val CompactWorkspaceTabLimit = 4

internal fun authenticatedHosts(hosts: List<SshHostProfile>): List<SshHostProfile> =
    hosts.filter { it.identityRefId != null }

internal fun defaultAuthenticatedHost(hosts: List<SshHostProfile>): SshHostProfile? =
    authenticatedHosts(hosts).firstOrNull()

internal fun canSaveRepository(host: SshHostProfile?, remotePath: String): Boolean =
    host?.identityRefId != null && remotePath.trim().startsWith("/")

internal fun directoryBrowserRootPath(remotePath: String): String =
    remotePath.trim().takeIf { it.startsWith("/") } ?: "/"

internal fun directoryBrowserParentPath(path: String): String? {
    val normalized = directoryBrowserRootPath(path)
    if (normalized == "/") return null
    val trimmed = normalized.trimEnd('/')
    val parent = trimmed.substringBeforeLast("/", missingDelimiterValue = "")
    return parent.ifBlank { "/" }
}

internal fun shouldLoadDirectoryPage(state: ResourceState<List<RemoteDirectoryEntry>>?): Boolean = when (state) {
    null,
    ResourceState.Idle,
    is ResourceState.Error,
    -> true
    ResourceState.Loading,
    is ResourceState.Loaded,
    is ResourceState.Stale,
    -> false
}

internal fun repositoryWorkspaceTabs(repository: RemoteRepositoryProfile): List<RepositoryWorkspaceTab> =
    if (repository.remotePath.startsWith("/")) {
        listOf(
            RepositoryWorkspaceTab.Branches,
            RepositoryWorkspaceTab.Worktrees,
            RepositoryWorkspaceTab.Terminal,
        )
    } else {
        emptyList()
    }

internal fun repositoryWorkspaceTabsUseScrollableStrip(tabs: List<RepositoryWorkspaceTab>): Boolean =
    tabs.size > CompactWorkspaceTabLimit

internal fun repositoryWorkspaceTabIndex(
    tabs: List<RepositoryWorkspaceTab>,
    selectedTab: RepositoryWorkspaceTab,
    fallback: RepositoryWorkspaceTab = RepositoryWorkspaceTab.Branches,
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

internal fun suggestedBranchName(baseBranch: String, existingBranchNames: Set<String>): String {
    val base = baseBranch.trim().ifBlank { "new-branch" }
    val candidate = "$base-new"
    if (candidate !in existingBranchNames) return candidate
    var suffix = 2
    while ("$candidate-$suffix" in existingBranchNames) {
        suffix += 1
    }
    return "$candidate-$suffix"
}

internal fun canCreateBranch(
    baseBranch: String,
    newBranch: String,
    existingBranchNames: Set<String>,
): Boolean {
    val base = baseBranch.trim()
    val next = newBranch.trim()
    return base.isNotBlank() && next.isNotBlank() && next !in existingBranchNames
}

internal fun branchDeleteBlockedReason(branch: RemoteRepositoryBranch): String? = when {
    branch.isCurrent -> "Current branch cannot be deleted."
    branch.isDefault -> "Default branch cannot be deleted."
    branch.worktreePath != null -> "Branch with a worktree cannot be deleted."
    else -> null
}

internal fun canDeleteBranch(branch: RemoteRepositoryBranch): Boolean =
    branchDeleteBlockedReason(branch) == null

internal fun branchDeleteConfirmationText(branch: RemoteRepositoryBranch): String =
    "Delete remote branch ${branch.name}? This does not delete worktrees."

internal fun canCheckoutBranch(branch: RemoteRepositoryBranch): Boolean = !branch.isCurrent

internal fun branchCheckoutConfirmationText(branch: RemoteRepositoryBranch): String =
    "Checkout remote branch ${branch.name}? This changes the repository working tree."

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

internal fun terminalWorkspaceSessions(
    hostId: String,
    sessions: List<TerminalSessionRecord>,
    remotePath: String,
): List<TerminalSessionRecord> =
    terminalWorkspaceOrderedSessions(sessions = sessions, hostId = hostId, remotePath = remotePath)

internal fun terminalWorkspaceSessions(
    hostIds: Set<String>,
    sessions: List<TerminalSessionRecord>,
    remotePath: String,
): List<TerminalSessionRecord> =
    terminalWorkspaceOrderedSessions(sessions = sessions, hostIds = hostIds, remotePath = remotePath)

internal fun terminalSessionDefaultLabel(index: Int): String = terminalSessionDisplayName(index)

internal fun terminalSessionDefaultLabel(session: TerminalSessionRecord, index: Int): String =
    session.displayName.ifBlank { terminalSessionDisplayName(index) }

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
    DateUtils.getRelativeTimeSpanString(
        session.lastActivityAt ?: session.openedAt,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
    ).let { "last activated $it" }

internal fun requiresTerminalDeleteConfirmation(session: TerminalSessionRecord): Boolean =
    session.status == TerminalSessionStatus.Starting || session.status == TerminalSessionStatus.Running

internal fun terminalDeleteConfirmationText(label: String, session: TerminalSessionRecord): String =
    "$label at ${session.remotePath} is still active. This will stop the terminal process and remove the terminal record."

private data class TerminalDeleteTarget(
    val session: TerminalSessionRecord,
    val label: String,
)

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
    var directoryBrowserPath by remember { mutableStateOf<String?>(null) }
    var directoryEntriesState: ResourceState<List<RemoteDirectoryEntry>> by remember { mutableStateOf(ResourceState.Idle) }
    var saving by remember { mutableStateOf(false) }
    val selectedHost = authenticated.firstOrNull { it.id == selectedHostId }
    val scope = rememberCoroutineScope()

    fun clearDirectoryBrowser() {
        directoryBrowserPath = null
        directoryEntriesState = ResourceState.Idle
    }

    fun loadDirectoryPage(path: String) {
        val host = selectedHost ?: return
        val normalizedPath = directoryBrowserRootPath(path)
        val requestHostId = host.id
        directoryBrowserPath = normalizedPath
        directoryEntriesState = ResourceState.Loading
        error = null
        scope.launch {
            val nextState = runCatching {
                withContext(Dispatchers.IO) { onBrowseDirectories(host, normalizedPath) }
            }.fold(
                onSuccess = { ResourceState.Loaded(it) },
                onFailure = { ResourceState.Error(it.message ?: "Remote directory browse failed", it) },
            )
            if (selectedHostId != requestHostId || directoryBrowserPath != normalizedPath) return@launch
            directoryEntriesState = nextState
        }
    }

    fun openDirectoryPage(path: String) {
        val normalizedPath = directoryBrowserRootPath(path)
        if (directoryBrowserPath == normalizedPath && !shouldLoadDirectoryPage(directoryEntriesState)) {
            return
        }
        loadDirectoryPage(normalizedPath)
    }

    fun browseDirectories() {
        openDirectoryPage(remotePath)
    }

    fun openParentDirectory() {
        directoryBrowserPath?.let(::directoryBrowserParentPath)?.let(::openDirectoryPage)
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
                clearDirectoryBrowser()
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
                .verticalScroll(rememberScrollState())
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
                                        clearDirectoryBrowser()
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
                        onValueChange = {
                            remotePath = it
                            clearDirectoryBrowser()
                        },
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
                    directoryBrowserPath?.let { currentPath ->
                        DirectoryPagePicker(
                            currentPath = currentPath,
                            state = directoryEntriesState,
                            onOpenParent = ::openParentDirectory,
                            onOpenDirectory = ::openDirectoryPage,
                            onSelect = { selectedPath -> remotePath = selectedPath },
                        )
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
private fun DirectoryPagePicker(
    currentPath: String,
    state: ResourceState<List<RemoteDirectoryEntry>>,
    onOpenParent: () -> Unit,
    onOpenDirectory: (String) -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
        Text("Remote directories", style = MaterialTheme.typography.titleSmall)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(currentPath, style = MaterialTheme.typography.bodyMedium)
            }
            TextButton(
                enabled = directoryBrowserParentPath(currentPath) != null,
                onClick = onOpenParent,
            ) {
                Text("Up")
            }
            TextButton(onClick = { onSelect(currentPath) }) {
                Text("Select")
            }
        }
        when (state) {
            ResourceState.Idle -> Text("Not loaded.", style = MaterialTheme.typography.bodySmall)
            ResourceState.Loading -> Text("Loading directories.", style = MaterialTheme.typography.bodySmall)
            is ResourceState.Error -> Text(
                state.message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
            is ResourceState.Loaded -> DirectoryPageEntries(
                entries = state.value,
                onOpenDirectory = onOpenDirectory,
                onSelect = onSelect,
            )
            is ResourceState.Stale -> DirectoryPageEntries(
                entries = state.value,
                onOpenDirectory = onOpenDirectory,
                onSelect = onSelect,
            )
        }
    }
}

@Composable
private fun DirectoryPageEntries(
    entries: List<RemoteDirectoryEntry>,
    onOpenDirectory: (String) -> Unit,
    onSelect: (String) -> Unit,
) {
    if (entries.isEmpty()) {
        Text("No child directories.", style = MaterialTheme.typography.bodySmall)
        return
    }
    val listState = rememberLazyListState()
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 260.dp),
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxWidth()
                .padding(end = 8.dp),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            items(entries, key = { it.path }) { entry ->
                DirectoryPageEntryRow(
                    entry = entry,
                    onOpenDirectory = onOpenDirectory,
                    onSelect = onSelect,
                )
            }
        }
        DirectoryPageScrollbar(
            listState = listState,
            totalItems = entries.size,
            modifier = Modifier.align(Alignment.CenterEnd),
        )
    }
}

@Composable
private fun DirectoryPageEntryRow(
    entry: RemoteDirectoryEntry,
    onOpenDirectory: (String) -> Unit,
    onSelect: (String) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(entry.name, style = MaterialTheme.typography.bodyMedium)
            Text(entry.path, style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = { onOpenDirectory(entry.path) }) {
            Text("Open")
        }
        TextButton(onClick = { onSelect(entry.path) }) {
            Text("Select")
        }
    }
}

@Composable
private fun DirectoryPageScrollbar(
    listState: LazyListState,
    totalItems: Int,
    modifier: Modifier = Modifier,
) {
    val visibleItems = listState.layoutInfo.visibleItemsInfo.size
    if (totalItems <= 0 || visibleItems <= 0 || totalItems <= visibleItems) return

    val availableItems = (totalItems - visibleItems).coerceAtLeast(1)
    val scrollProgress = (listState.firstVisibleItemIndex.toFloat() / availableItems).coerceIn(0f, 1f)
    val thumbFraction = (visibleItems.toFloat() / totalItems).coerceIn(0.15f, 0.9f)
    val movableFraction = 1f - thumbFraction
    val topWeight = scrollProgress * movableFraction
    val bottomWeight = (movableFraction - topWeight).coerceAtLeast(0f)

    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(4.dp)
            .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        if (topWeight > 0f) Box(Modifier.weight(topWeight))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(thumbFraction)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)),
        )
        if (bottomWeight > 0f) Box(Modifier.weight(bottomWeight))
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
    onCreateBranch: (String, String) -> Unit = { _, _ -> },
    onCheckoutBranch: (RemoteRepositoryBranch) -> Unit = {},
    onDeleteBranch: (RemoteRepositoryBranch) -> Unit = {},
    onCreateWorktree: (String, String) -> Unit = { _, _ -> },
    onRemoveWorktree: (RemoteRepositoryWorktree) -> Unit = {},
) {
    var selectedTab by remember(repository.id) {
        mutableStateOf(
            if (initialTerminalWorkspacePath == null) {
                RepositoryWorkspaceTab.Branches
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
    var confirmDelete by remember(repository.id) { mutableStateOf(false) }
    var branchCheckoutTarget by remember(repository.id) { mutableStateOf<RemoteRepositoryBranch?>(null) }
    var branchDeleteTarget by remember(repository.id) { mutableStateOf<RemoteRepositoryBranch?>(null) }
    var removeTarget by remember(repository.id) { mutableStateOf<RemoteRepositoryWorktree?>(null) }
    var terminalDeleteTarget by remember(repository.id) { mutableStateOf<TerminalDeleteTarget?>(null) }
    var actionError by remember(repository.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val workspaceTabs = remember(repository.id, repository.remotePath) {
        repositoryWorkspaceTabs(repository)
    }

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

    fun createBranch(baseBranch: String, newBranch: String) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onCreateBranch(baseBranch, newBranch) }
            }.onSuccess {
                refreshSnapshot()
            }.onFailure {
                actionError = it.message ?: "Remote branch create failed"
            }
        }
    }

    fun deleteBranch(branch: RemoteRepositoryBranch) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onDeleteBranch(branch) }
            }.onSuccess {
                branchDeleteTarget = null
                refreshSnapshot()
            }.onFailure {
                actionError = it.message ?: "Remote branch delete failed"
            }
        }
    }

    fun checkoutBranch(branch: RemoteRepositoryBranch) {
        actionError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onCheckoutBranch(branch) }
            }.onSuccess {
                branchCheckoutTarget = null
                refreshSnapshot()
            }.onFailure {
                actionError = it.message ?: "Remote branch checkout failed"
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

    BackHandler { onBack() }

    val density = LocalDensity.current
    val backSwipeDistancePx = with(density) { 72.dp.toPx() }
    val backSwipeEdgePx = with(density) { 28.dp.toPx() }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(onBack) {
                var draggedDistance = 0f
                var tracking = false
                var shouldHandle = true
                detectHorizontalDragGestures(
                    onHorizontalDrag = { change, amount ->
                        if (!shouldHandle) return@detectHorizontalDragGestures
                        if (!tracking) {
                            if (change.position.x <= backSwipeEdgePx) {
                                tracking = true
                            } else {
                                return@detectHorizontalDragGestures
                            }
                        }
                        draggedDistance += amount
                        if (draggedDistance.absoluteValue >= backSwipeDistancePx) {
                            onBack()
                            shouldHandle = false
                        }
                    },
                    onDragEnd = {
                        draggedDistance = 0f
                        tracking = false
                        shouldHandle = true
                    },
                    onDragCancel = {
                        draggedDistance = 0f
                        tracking = false
                        shouldHandle = true
                    },
                )
            },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = host.subtitle,
                        style = MaterialTheme.typography.titleSmall,
                    )
                },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("Back")
                    }
                },
                actions = {
                    TextButton(onClick = { refreshSnapshot() }) {
                        Text("Refresh")
                    }
                    TextButton(onClick = { confirmDelete = true }) {
                        Text("Delete")
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
                actionError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            RepositoryWorkspaceTabStrip(
                tabs = workspaceTabs,
                selectedTab = selectedTab,
                onSelectTab = { selectedTab = it },
                onSelectPreviousTab = {
                    if (workspaceTabs.isNotEmpty()) {
                        val currentIndex = repositoryWorkspaceTabIndex(workspaceTabs, selectedTab)
                        val previousIndex = if (currentIndex <= 0) workspaceTabs.lastIndex else currentIndex - 1
                        selectedTab = workspaceTabs[previousIndex]
                    }
                },
                onSelectNextTab = {
                    if (workspaceTabs.isNotEmpty()) {
                        val currentIndex = repositoryWorkspaceTabIndex(workspaceTabs, selectedTab)
                        val nextIndex = if (currentIndex >= workspaceTabs.lastIndex) 0 else currentIndex + 1
                        selectedTab = workspaceTabs[nextIndex]
                    }
                },
            )
            when (selectedTab) {
                RepositoryWorkspaceTab.Branches -> RepositoryBranchesPanel(
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onSelectTerminalWorkspace = ::selectTerminalWorkspace,
                    onCreateBranch = ::createBranch,
                    onCheckoutBranch = { branchCheckoutTarget = it },
                    onDeleteBranch = { branchDeleteTarget = it },
                )

                RepositoryWorkspaceTab.Worktrees -> RepositoryWorktreesPanel(
                    repository = repository,
                    snapshotState = snapshotState,
                    onRefresh = { refreshSnapshot() },
                    onSelectTerminalWorkspace = ::selectTerminalWorkspace,
                    onCreateWorktree = ::createWorktree,
                    onRemoveWorktree = { removeTarget = it },
                )
                RepositoryWorkspaceTab.Commits -> Unit
                RepositoryWorkspaceTab.Ports -> Unit
                RepositoryWorkspaceTab.Terminal -> RepositoryTerminalPanel(
                    hostProfileId = host.id,
                    targetHostId = RemoteTarget.fromHostProfile(host, selectedTerminalWorkspacePath).id,
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

    branchCheckoutTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { branchCheckoutTarget = null },
            title = { Text("Checkout remote branch?") },
            text = { Text(branchCheckoutConfirmationText(target)) },
            confirmButton = {
                TextButton(onClick = { checkoutBranch(target) }) {
                    Text("Checkout")
                }
            },
            dismissButton = {
                TextButton(onClick = { branchCheckoutTarget = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    branchDeleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { branchDeleteTarget = null },
            title = { Text("Delete remote branch?") },
            text = { Text(branchDeleteConfirmationText(target)) },
            confirmButton = {
                TextButton(onClick = { deleteBranch(target) }) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { branchDeleteTarget = null }) {
                    Text("Cancel")
                }
            },
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
    onSelectPreviousTab: () -> Unit,
    onSelectNextTab: () -> Unit,
) {
    if (tabs.isEmpty()) return
    val canCycle = tabs.size > 1
    val density = LocalDensity.current
    val tabSwipeDistancePx = with(density) { 72.dp.toPx() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .pointerInput(tabs, canCycle, onSelectNextTab, onSelectPreviousTab) {
                if (!canCycle) return@pointerInput
                var draggedDistance = 0f
                detectHorizontalDragGestures(
                    onHorizontalDrag = { _, amount ->
                        draggedDistance += amount
                        when {
                            draggedDistance >= tabSwipeDistancePx -> {
                                onSelectPreviousTab()
                                draggedDistance = 0f
                            }
                            draggedDistance <= -tabSwipeDistancePx -> {
                                onSelectNextTab()
                                draggedDistance = 0f
                            }
                        }
                    },
                    onDragEnd = { draggedDistance = 0f },
                    onDragCancel = { draggedDistance = 0f },
                )
            },
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (repositoryWorkspaceTabsUseScrollableStrip(tabs)) {
            PrimaryScrollableTabRow(
                modifier = Modifier.weight(1f),
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
        } else {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                tabs.forEach { tab ->
                    TextButton(onClick = { onSelectTab(tab) }) {
                        Text(tab.label)
                    }
                }
            }
        }
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
private fun RepositoryBranchesPanel(
    snapshotState: ResourceState<RemoteRepositorySnapshot>,
    onRefresh: () -> Unit,
    onSelectTerminalWorkspace: (String) -> Unit,
    onCreateBranch: (String, String) -> Unit,
    onCheckoutBranch: (RemoteRepositoryBranch) -> Unit,
    onDeleteBranch: (RemoteRepositoryBranch) -> Unit,
) {
    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        val branchNames = snapshot.branches.map { it.name }
        val existingBranchNames = branchNames.toSet()
        val initialBaseBranch = snapshot.branches.firstOrNull { it.isCurrent }?.name
            ?: snapshot.branches.firstOrNull { it.isDefault }?.name
            ?: branchNames.firstOrNull()
            ?: ""
        var baseBranch by remember(snapshot.branches) { mutableStateOf(initialBaseBranch) }
        var newBranch by remember(snapshot.branches) {
            mutableStateOf(suggestedBranchName(initialBaseBranch, existingBranchNames))
        }
        var branchMenuExpanded by remember(snapshot.branches) { mutableStateOf(false) }

        fun updateBaseBranch(value: String) {
            baseBranch = value
            newBranch = suggestedBranchName(value, existingBranchNames)
        }

        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            if (snapshot.branches.isEmpty()) {
                Text("No branches found.")
            } else {
                Card(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(GoblinSpacing.Md),
                        verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                    ) {
                        Text("Create branch", style = MaterialTheme.typography.titleMedium)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                modifier = Modifier.weight(1f),
                                value = baseBranch,
                                onValueChange = ::updateBaseBranch,
                                label = { Text("Base branch") },
                                singleLine = true,
                            )
                            TextButton(onClick = { branchMenuExpanded = true }) {
                                Text("Select")
                            }
                            DropdownMenu(
                                expanded = branchMenuExpanded,
                                onDismissRequest = { branchMenuExpanded = false },
                            ) {
                                branchNames.forEach { branchName ->
                                    DropdownMenuItem(
                                        text = { Text(branchName) },
                                        onClick = {
                                            updateBaseBranch(branchName)
                                            branchMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = newBranch,
                            onValueChange = { newBranch = it },
                            label = { Text("New branch") },
                            singleLine = true,
                        )
                        Button(
                            enabled = canCreateBranch(baseBranch, newBranch, existingBranchNames),
                            onClick = { onCreateBranch(baseBranch.trim(), newBranch.trim()) },
                        ) {
                            Text("Create branch")
                        }
                    }
                }
                snapshot.branches.forEach { branch ->
                    BranchRow(
                        branch = branch,
                        onSelectTerminalWorkspace = onSelectTerminalWorkspace,
                        onCheckoutBranch = onCheckoutBranch,
                        onDeleteBranch = onDeleteBranch,
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
    onCheckoutBranch: (RemoteRepositoryBranch) -> Unit,
    onDeleteBranch: (RemoteRepositoryBranch) -> Unit,
) {
    val deleteBlockedReason = branchDeleteBlockedReason(branch)
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
                deleteBlockedReason?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs)) {
                branch.worktreePath?.let { path ->
                    TextButton(onClick = { onSelectTerminalWorkspace(path) }) {
                        Text("Terminals")
                    }
                }
                TextButton(
                    enabled = canCheckoutBranch(branch),
                    onClick = { onCheckoutBranch(branch) },
                ) {
                    Text("Checkout")
                }
                TextButton(
                    enabled = deleteBlockedReason == null,
                    onClick = { onDeleteBranch(branch) },
                ) {
                    Text("Delete")
                }
            }
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
    var branchMenuExpanded by remember(repository.id) { mutableStateOf(false) }
    var worktreePath by remember(repository.id) { mutableStateOf("") }

    fun updateBranch(value: String) {
        branch = value
        worktreePath = suggestedWorktreePath(repository.remotePath, value)
    }

    val branches = when (snapshotState) {
        is ResourceState.Loaded -> snapshotState.value.branches
        is ResourceState.Stale -> snapshotState.value.branches
        else -> emptyList()
    }
    val defaultBranch = branches.firstOrNull { it.isDefault } ?: branches.firstOrNull()

    LaunchedEffect(repository.id, defaultBranch?.name, snapshotState) {
        if (branch.isBlank() && defaultBranch != null) {
            updateBranch(defaultBranch.name)
        }
    }

    SnapshotContent(snapshotState = snapshotState, onRefresh = onRefresh) { snapshot ->
        Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
            Card(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(GoblinSpacing.Md),
                    verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                ) {
                    Text("Create worktree", style = MaterialTheme.typography.titleMedium)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            modifier = Modifier.weight(1f),
                            value = branch,
                            onValueChange = { updateBranch(it) },
                            label = { Text("Base branch") },
                            singleLine = true,
                        )
                        if (branches.isNotEmpty()) {
                            TextButton(onClick = { branchMenuExpanded = true }) {
                                Text("Select branch")
                            }
                            DropdownMenu(
                                expanded = branchMenuExpanded,
                                onDismissRequest = { branchMenuExpanded = false },
                            ) {
                                branches.forEach { branchEntry ->
                                    DropdownMenuItem(
                                        text = { Text(branchEntry.name) },
                                        onClick = {
                                            updateBranch(branchEntry.name)
                                            branchMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                    }
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
    val worktreeTitle = worktree.path
        .trim()
        .trimEnd('/')
        .substringAfterLast('/', missingDelimiterValue = worktree.path)
        .ifBlank { worktree.path }
    val workspaceSummary = run {
        val badges = worktreeBadges(worktree).joinToString(" ")
        buildString {
            append(worktree.branch ?: "detached")
            if (badges.isNotBlank()) {
                append(" · ")
                append(badges)
            }
        }
    }
    val actionButtonPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)

    Card(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
        ) {
            Text(
                worktreeTitle,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
            )
            if (workspaceSummary.isNotBlank()) {
                Text(
                    workspaceSummary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Clip,
                )
            }
            Text(
                worktree.path,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Clip,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (removalSafety.allowed) {
                    Spacer(Modifier.weight(1f))
                } else {
                    Text(
                        removalSafety.reason.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Row {
                    TextButton(
                        onClick = { onSelectTerminalWorkspace(worktreeTerminalPath(worktree)) },
                        contentPadding = actionButtonPadding,
                    ) {
                        Text("Terminals", style = MaterialTheme.typography.labelMedium)
                    }
                    if (removalSafety.allowed) {
                        Spacer(Modifier.width(4.dp))
                        TextButton(
                            onClick = { onRemoveWorktree(worktree) },
                            contentPadding = actionButtonPadding,
                        ) {
                            Text("Remove", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RepositoryTerminalPanel(
    hostProfileId: String,
    targetHostId: String,
    path: String,
    sessions: List<TerminalSessionRecord>,
    onCreateTerminalAtPath: (String) -> Unit,
    onOpenTerminalSession: (TerminalSessionRecord) -> Unit,
    onDeleteTerminalSession: (TerminalSessionRecord, String) -> Unit,
) {
    val selectedPath = terminalSessionRemotePath(path)
    val terminalHostIds = remember(hostProfileId, targetHostId) { setOf(hostProfileId, targetHostId) }
    val workspaceSessionCounts = terminalWorkspaceSessionCountsByPath(
        sessions = sessions,
        hostIds = terminalHostIds,
    )
    val workspaceSessions = terminalWorkspaceSessions(hostIds = terminalHostIds, sessions = sessions, remotePath = selectedPath)
    val stableOrderedSessions = terminalWorkspaceCreatedSessions(sessions, terminalHostIds, path)
    val openedOrderLabels = stableOrderedSessions
        .mapIndexed { index, session -> session.id to terminalSessionDefaultLabel(session, index) }
        .toMap()
    val activeWorktreeCount = workspaceSessionCounts.find { it.first == selectedPath }?.second ?: 0
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text("Terminal workspace", style = MaterialTheme.typography.titleMedium)
                Text(selectedPath)
                Text("$activeWorktreeCount terminals in this worktree")
                if (workspaceSessionCounts.isNotEmpty()) {
                    Text("Worktree terminal counts:")
                    Column(
                        modifier = Modifier.padding(start = GoblinSpacing.Xs),
                        verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                    ) {
                        workspaceSessionCounts.forEach { (worktreePath, count) ->
                            val selectedMark = if (worktreePath == selectedPath) "*" else "-"
                            Text("$selectedMark $worktreePath: $count")
                        }
                    }
                }
                Button(onClick = { onCreateTerminalAtPath(path) }) {
                    Text("New terminal")
                }
            }
        }
        if (workspaceSessions.isEmpty()) {
            Text("No terminals for this worktree.")
        } else {
            Column(
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                workspaceSessions.forEach { session ->
                    val label = openedOrderLabels[session.id] ?: terminalSessionDefaultLabel(0)
                    SwipeDeleteTerminalSessionRow(
                        onDelete = { onDeleteTerminalSession(session, label) },
                    ) {
                        TerminalSessionRow(
                            session = session,
                            label = label,
                            onOpenTerminalSession = onOpenTerminalSession,
                            onDeleteTerminalSession = onDeleteTerminalSession,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SwipeDeleteTerminalSessionRow(
    onDelete: () -> Unit,
    content: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val revealDistancePx = with(density) { 88.dp.toPx() }
    val confirmDistancePx = with(density) { 48.dp.toPx() }
    val offsetX = remember {
        Animatable(0f)
    }
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .background(MaterialTheme.colorScheme.errorContainer)
                .padding(GoblinSpacing.Md),
            contentAlignment = Alignment.CenterEnd,
        ) {
            TextButton(onClick = onDelete) {
                Text("Delete")
            }
        }
        Box(
            modifier = Modifier
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .pointerInput(revealDistancePx) {
                    detectHorizontalDragGestures(
                        onHorizontalDrag = { _, amount ->
                            val next = (offsetX.value + amount).coerceIn(-revealDistancePx, 0f)
                            scope.launch {
                                offsetX.snapTo(next)
                            }
                        },
                        onDragEnd = {
                            scope.launch {
                                val shouldDelete = offsetX.value <= -confirmDistancePx
                                offsetX.animateTo(0f)
                                if (shouldDelete) onDelete()
                            }
                        },
                        onDragCancel = {
                            scope.launch {
                                offsetX.animateTo(0f)
                            }
                        },
                    )
                },
        ) {
            content()
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
    Card(
        Modifier
            .fillMaxWidth()
            .clickable { onOpenTerminalSession(session) },
    ) {
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
