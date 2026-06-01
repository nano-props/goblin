package dev.goblin.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.RemoteRepositoryStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.navigation.AppRoute
import dev.goblin.android.ssh.RemoteRepositoryGitService
import dev.goblin.android.ssh.RemoteWorktreeService
import dev.goblin.android.ssh.PortForwardManager
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshInitializationService
import dev.goblin.android.terminal.TerminalForegroundBridge
import dev.goblin.android.terminal.TerminalSessionManager
import dev.goblin.android.terminal.TerminalSessionRecord
import dev.goblin.android.ui.screens.addhost.AddHostScreen
import dev.goblin.android.ui.screens.diagnostics.DiagnosticsScreen
import dev.goblin.android.ui.screens.hosts.HostsScreen
import dev.goblin.android.ui.screens.placeholders.SettingsPlaceholderScreen
import dev.goblin.android.ui.screens.repositories.RepositorySetupScreen
import dev.goblin.android.ui.screens.repositories.RepositoryWorkspaceScreen
import dev.goblin.android.ui.screens.terminal.TerminalScreen
import dev.goblin.android.ui.screens.terminal.terminalTargetLabel
import kotlinx.coroutines.launch

@Composable
fun GoblinAndroidApp(
    hostProfileStore: HostProfileStore,
    remoteRepositoryStore: RemoteRepositoryStore,
    secureIdentityStore: SecureIdentityStore,
    diagnosticsService: SshDiagnosticsService,
    remoteRepositoryGitService: RemoteRepositoryGitService,
    remoteWorktreeService: RemoteWorktreeService,
    portForwardManager: PortForwardManager,
    initializationService: SshInitializationService,
    terminalSessionManager: TerminalSessionManager,
    terminalForegroundBridge: TerminalForegroundBridge,
    initialTerminalSessionId: String? = null,
) {
    var route: AppRoute by remember(initialTerminalSessionId) {
        val initialTerminalRoute = initialTerminalSessionId
            ?.let { terminalSessionManager.session(it) }
            ?.let {
                AppRoute.Terminal(
                    hostId = it.hostId,
                    remotePath = it.remotePath,
                    repositoryId = it.repositoryId,
                    terminalSessionId = it.id,
                )
            }
        mutableStateOf(initialTerminalRoute ?: AppRoute.Hosts)
    }
    var hostsState: ResourceState<List<SshHostProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(hostProfileStore.loadHosts()))
    }
    var repositoriesState: ResourceState<List<RemoteRepositoryProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(remoteRepositoryStore.loadRepositories()))
    }
    var terminalSessions: List<TerminalSessionRecord> by remember {
        mutableStateOf(terminalSessionManager.sessions())
    }
    val scope = rememberCoroutineScope()

    DisposableEffect(terminalSessionManager) {
        val observer = terminalSessionManager.observeSessions { sessions ->
            scope.launch {
                terminalSessions = sessions
            }
        }
        onDispose {
            observer.close()
        }
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

    fun stopRepositoryRuntimeResources(repositoryId: String) {
        portForwardManager.stopOwner(repositoryId)
        terminalSessionManager.removeRepositorySessions(repositoryId)
        terminalForegroundBridge.sync()
    }

    fun deleteRepositoryRecord(repositoryId: String) {
        stopRepositoryRuntimeResources(repositoryId)
        remoteRepositoryStore.deleteRepository(repositoryId)
        reloadRepositories()
    }

    when (val currentRoute = route) {
        AppRoute.Hosts -> HostsScreen(
            hostsState = hostsState,
            repositories = currentRepositories(),
            onAddHost = { route = AppRoute.AddHost },
            onAddRepository = { route = AppRoute.AddRepository },
            onOpenRepository = { repositoryId -> route = AppRoute.Repository(repositoryId) },
            onDeleteRepository = { repositoryId ->
                deleteRepositoryRecord(repositoryId)
            },
            onEditHost = { hostId -> route = AppRoute.EditHost(hostId) },
            onDeleteHost = { hostId ->
                currentRepositories()
                    .filter { it.hostProfileId == hostId }
                    .forEach { stopRepositoryRuntimeResources(it.id) }
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
            onCheckSshInitialization = { input -> initializationService.check(input) },
            onTrustHostKey = { input, fingerprint -> initializationService.trustHostKey(input, fingerprint) },
            onInitializeSshAccess = { input, password ->
                val result = initializationService.initialize(input, password)
                result.profile
            },
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
                    onCheckSshInitialization = { input -> initializationService.check(input) },
                    onTrustHostKey = { input, fingerprint -> initializationService.trustHostKey(input, fingerprint) },
                    onInitializeSshAccess = { input, password ->
                        val result = initializationService.initialize(input, password)
                        result.profile
                    },
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
                    onOpenRepository = { repositoryId -> route = AppRoute.Repository(repositoryId) },
                    onOpenRepositoryTerminal = { repository ->
                        route = AppRoute.Terminal(currentRoute.hostId, repository.remotePath, repository.id)
                    },
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
                    onInspectRepository = { remotePath ->
                        remoteRepositoryGitService.inspectRepository(RemoteTarget.fromHostProfile(routeHost(), remotePath))
                    },
                    onDeleteRepository = { repositoryId ->
                        deleteRepositoryRecord(repositoryId)
                    },
                )
            }
        }

        AppRoute.AddRepository -> RepositorySetupScreen(
            hosts = currentHosts(),
            repositories = currentRepositories(),
            onBack = { route = AppRoute.Hosts },
            onSaveRepository = { repository ->
                remoteRepositoryStore.saveRepository(repository)
                reloadRepositories()
            },
            onDeleteRepository = { repositoryId ->
                deleteRepositoryRecord(repositoryId)
            },
            onOpenRepository = { repositoryId -> route = AppRoute.Repository(repositoryId) },
            onBrowseDirectories = { host, remotePath ->
                remoteRepositoryGitService.browseDirectories(RemoteTarget.fromHostProfile(host, remotePath))
            },
            onInspectRepository = { host, remotePath ->
                remoteRepositoryGitService.inspectRepository(RemoteTarget.fromHostProfile(host, remotePath))
            },
        )

        is AppRoute.Repository -> {
            val repository = currentRepositories().firstOrNull { it.id == currentRoute.repositoryId }
            val host = repository?.let { repo -> currentHosts().firstOrNull { it.id == repo.hostProfileId } }
            if (repository == null || host == null) {
                route = AppRoute.Hosts
            } else {
                RepositoryWorkspaceScreen(
                    host = host,
                    repository = repository,
                    onBack = { route = AppRoute.Hosts },
                    onLoadSnapshot = {
                        remoteRepositoryGitService.loadSnapshot(
                            RemoteTarget.fromHostProfile(host, repository.remotePath),
                        )
                    },
                    initialTerminalWorkspacePath = currentRoute.terminalWorkspacePath,
                    terminalSessions = terminalSessions,
                    onCreateTerminalAtPath = { remotePath ->
                        val session = terminalSessionManager.createNew(
                            target = RemoteTarget.fromHostProfile(host, remotePath),
                            repositoryId = repository.id,
                            targetLabel = terminalTargetLabel(repository.title, remotePath),
                        )
                        terminalForegroundBridge.sync()
                        session
                    },
                    onOpenTerminalSession = { session ->
                        route = AppRoute.Terminal(
                            hostId = host.id,
                            remotePath = session.remotePath,
                            repositoryId = repository.id,
                            terminalSessionId = session.id,
                        )
                    },
                    onDeleteTerminalSession = { sessionId ->
                        terminalSessionManager.removeSession(sessionId)
                        terminalForegroundBridge.sync()
                    },
                    onDeleteRepository = {
                        deleteRepositoryRecord(repository.id)
                        route = AppRoute.Hosts
                    },
                    onCreateWorktree = { branch, worktreePath ->
                        remoteWorktreeService.createWorktree(
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            branch = branch,
                            worktreePath = worktreePath,
                        )
                    },
                    onRemoveWorktree = { worktree ->
                        remoteWorktreeService.removeWorktree(
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            worktree = worktree,
                        )
                        terminalSessionManager.removeWorkspaceSessions(repository.id, worktree.path)
                        terminalForegroundBridge.sync()
                    },
                    portForwardSessions = portForwardManager.sessions(repository.id),
                    onStartPortForward = { request ->
                        portForwardManager.start(
                            owner = PortForwardOwner(
                                id = repository.id,
                                label = repository.title,
                            ),
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            request = request,
                        )
                    },
                    onStopPortForward = { sessionId -> portForwardManager.stop(sessionId) },
                )
            }
        }

        is AppRoute.Terminal -> {
            val host = currentHosts().firstOrNull { it.id == currentRoute.hostId }
            if (host == null) {
                route = AppRoute.Hosts
            } else {
                val repository = currentRoute.repositoryId?.let { repositoryId ->
                    currentRepositories().firstOrNull { it.id == repositoryId }
                }
                TerminalScreen(
                    host = host,
                    remotePath = currentRoute.remotePath,
                    repositoryId = currentRoute.repositoryId,
                    targetLabel = terminalTargetLabel(repository?.title ?: host.title, currentRoute.remotePath),
                    terminalSessionId = currentRoute.terminalSessionId,
                    terminalSessionManager = terminalSessionManager,
                    terminalForegroundBridge = terminalForegroundBridge,
                    onBack = {
                        route = currentRoute.repositoryId
                            ?.let { AppRoute.Repository(it, terminalWorkspacePath = currentRoute.remotePath) }
                            ?: AppRoute.Diagnostics(currentRoute.hostId)
                    },
                )
            }
        }

        AppRoute.Settings -> SettingsPlaceholderScreen(onBack = { route = AppRoute.Hosts })
    }
}
