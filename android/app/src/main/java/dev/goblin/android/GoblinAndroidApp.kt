package dev.goblin.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.RemoteRepositoryStore
import dev.goblin.android.data.TerminalSettingsStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.navigation.AppRoute
import dev.goblin.android.ssh.RemoteBranchService
import dev.goblin.android.ssh.RemoteRepositoryGitService
import dev.goblin.android.ssh.RemoteWorktreeService
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshInitializationService
import dev.goblin.android.navigation.AppRoute.Companion.terminal
import dev.goblin.android.terminals.TerminalForegroundBridge
import dev.goblin.android.terminals.TerminalNavigationRequest
import dev.goblin.android.terminals.TerminalSessionManager
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.termux.ExternalTermuxLauncher
import dev.goblin.android.termux.externalTermuxLaunchRequest
import dev.goblin.android.ui.screens.addhost.AddHostScreen
import dev.goblin.android.ui.screens.diagnostics.DiagnosticsScreen
import dev.goblin.android.ui.navigation.MainTab
import dev.goblin.android.ui.navigation.MainTabShell
import dev.goblin.android.ui.screens.hosts.HostsScreen
import dev.goblin.android.ui.screens.hosts.hostTemporaryTerminalRoute
import dev.goblin.android.ui.screens.hosts.isHostTemporaryTerminal
import dev.goblin.android.ui.screens.projects.ProjectsScreen
import dev.goblin.android.ui.screens.settings.SettingsScreen
import dev.goblin.android.ui.screens.repositories.RepositorySetupScreen
import dev.goblin.android.ui.screens.repositories.RepositoryWorkspaceScreen
import dev.goblin.android.ui.screens.terminals.TerminalBackClosesSessionHint
import dev.goblin.android.ui.screens.terminals.TerminalBackKeepsSessionHint
import dev.goblin.android.ui.screens.terminals.TerminalScreen
import dev.goblin.android.ui.screens.terminals.terminalTargetLabel
import kotlinx.coroutines.launch

@Composable
fun GoblinAndroidApp(
    hostProfileStore: HostProfileStore,
    remoteRepositoryStore: RemoteRepositoryStore,
    secureIdentityStore: SecureIdentityStore,
    diagnosticsService: SshDiagnosticsService,
    remoteRepositoryGitService: RemoteRepositoryGitService,
    remoteBranchService: RemoteBranchService,
    remoteWorktreeService: RemoteWorktreeService,
    initializationService: SshInitializationService,
    terminalSettingsStore: TerminalSettingsStore,
    terminalSessionManager: TerminalSessionManager,
    terminalForegroundBridge: TerminalForegroundBridge,
    externalTermuxLauncher: ExternalTermuxLauncher,
    terminalNavigationRequest: TerminalNavigationRequest? = null,
) {
    val initialRepositories = remember {
        remoteRepositoryStore.loadRepositories()
    }

    var route: AppRoute by remember(initialRepositories) {
        mutableStateOf(if (initialRepositories.isNotEmpty()) AppRoute.Projects else AppRoute.Hosts)
    }

    LaunchedEffect(terminalNavigationRequest?.sequence) {
        val request = terminalNavigationRequest ?: return@LaunchedEffect
        val record = terminalSessionManager.session(request.sessionId) ?: return@LaunchedEffect
        route = terminal(record)
    }
    var hostsState: ResourceState<List<SshHostProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(hostProfileStore.loadHosts()))
    }
    var repositoriesState: ResourceState<List<RemoteRepositoryProfile>> by remember {
        mutableStateOf(ResourceState.Loaded(initialRepositories))
    }
    var terminalSessions: List<TerminalSessionRecord> by remember {
        mutableStateOf(terminalSessionManager.sessions())
    }
    var terminalFitToScreen by remember {
        mutableStateOf(terminalSettingsStore.loadTerminalFitToScreen())
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
        terminalSessionManager.removeRepositorySessions(repositoryId)
        terminalForegroundBridge.sync()
    }

    fun resolveHostForTerminalRoute(routeHostId: String): SshHostProfile? {
        val normalizedRouteHostId = routeHostId.trim().ifBlank { return null }
        val direct = currentHosts().firstOrNull { it.id == normalizedRouteHostId }
        if (direct != null) return direct

        val targetHostId = normalizedRouteHostId.substringBefore("/")
        return currentHosts().firstOrNull { "${it.user}@${it.host}:${it.port}" == targetHostId }
    }

    fun deleteRepositoryRecord(repositoryId: String) {
        stopRepositoryRuntimeResources(repositoryId)
        remoteRepositoryStore.deleteRepository(repositoryId)
        reloadRepositories()
    }

    fun selectMainTab(tab: MainTab) {
        route = when (tab) {
            MainTab.Hosts -> AppRoute.Hosts
            MainTab.Projects -> AppRoute.Projects
        }
    }

    fun mainTabForRoute(currentRoute: AppRoute): MainTab? = when (currentRoute) {
        AppRoute.Hosts -> MainTab.Hosts
        AppRoute.Projects -> MainTab.Projects
        else -> null
    }

    fun openHostTemporaryTerminal(hostId: String) {
        if (currentHosts().none { it.id == hostId }) return
        route = hostTemporaryTerminalRoute(hostId)
    }

    fun closeHostTemporaryTerminal(sessionId: String?) {
        sessionId?.let { terminalSessionManager.removeSession(it) }
        terminalForegroundBridge.sync()
    }

    when (val currentRoute = route) {
        AppRoute.Hosts,
        AppRoute.Projects,
        -> {
            val selectedTab = mainTabForRoute(currentRoute) ?: MainTab.Hosts
            MainTabShell(
                selectedTab = selectedTab,
                onSelectTab = ::selectMainTab,
                onOpenSettings = { route = AppRoute.Settings },
                onAddHost = { route = AppRoute.AddHost },
                onAddProject = { route = AppRoute.AddRepository },
                repositoriesState = repositoriesState,
                hostsContent = {
                    HostsScreen(
                        hostsState = hostsState,
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
                        onOpenTerminal = ::openHostTemporaryTerminal,
                    )
                },
                projectsContent = {
                    ProjectsScreen(
                        repositoriesState = repositoriesState,
                        hosts = currentHosts(),
                        onOpenProject = { repositoryId -> route = AppRoute.Repository(repositoryId) },
                        onOpenProjectTerminals = { repositoryId, terminalWorkspacePath ->
                            route = AppRoute.Repository(
                                repositoryId = repositoryId,
                                terminalWorkspacePath = terminalWorkspacePath,
                            )
                        },
                        onDeleteProject = { repositoryId ->
                            deleteRepositoryRecord(repositoryId)
                        },
                    )
                },
            )
        }

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
                fun routeHost(): SshHostProfile =
                    currentHosts().firstOrNull { it.id == currentRoute.hostId } ?: host

                DiagnosticsScreen(
                    host = host,
                    onBack = { route = AppRoute.Hosts },
                    onOpenTerminal = { route = AppRoute.Terminal(currentRoute.hostId) },
                    onCheckSshInitialization = { initializationService.check(routeHost()) },
                    onInitializeSshAccess = { password ->
                        val result = initializationService.initialize(routeHost(), password)
                        hostProfileStore.saveHost(result.profile)
                        reloadHosts()
                    },
                    onRunDiagnostics = {
                        val currentHost = routeHost()
                        val result = diagnosticsService.runDiagnostics(RemoteTarget.fromHostProfile(currentHost))
                        hostProfileStore.saveHost(
                            currentHost.copy(lastDiagnosticStatus = if (result.ok) "healthy" else "unhealthy"),
                        )
                        reloadHosts()
                        result
                    },
                    onTrustHostKey = { fingerprint ->
                        initializationService.trustHostKey(routeHost(), fingerprint)
                    },
                )
            }
        }

        AppRoute.AddRepository -> RepositorySetupScreen(
            hosts = currentHosts(),
            repositories = currentRepositories(),
            onBack = { route = AppRoute.Projects },
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
                route = AppRoute.Projects
            } else {
                RepositoryWorkspaceScreen(
                    host = host,
                    repository = repository,
                    onBack = { route = AppRoute.Projects },
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
                    onOpenExternalTermuxAtPath = { target ->
                        val request = externalTermuxLaunchRequest(target) { identityId ->
                            secureIdentityStore.loadProtectedBytesById(identityId)
                        }
                        try {
                            externalTermuxLauncher.openInTermux(request)
                        } finally {
                            request.privateKeyBytes?.fill(0)
                        }
                    },
                    onCopyExternalTermuxCommandAtPath = { target ->
                        externalTermuxLauncher.copyCommand(target)
                    },
                    onOpenTerminalSession = { session ->
                        terminalSessionManager.touchSession(session.id)
                        val target = RemoteTarget.fromHostProfile(host, session.remotePath)
                        route = AppRoute.Terminal(
                            hostId = target.id,
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
                        route = AppRoute.Projects
                    },
                    onCreateBranch = { baseBranch, newBranch ->
                        remoteBranchService.createAndCheckoutBranch(
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            baseBranch = baseBranch,
                            newBranch = newBranch,
                        )
                    },
                    onCheckoutBranch = { branch ->
                        remoteBranchService.checkoutBranch(
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            branch = branch.name,
                        )
                    },
                    onDeleteBranch = { branch ->
                        remoteBranchService.deleteBranch(
                            target = RemoteTarget.fromHostProfile(host, repository.remotePath),
                            branch = branch.name,
                        )
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
                )
            }
        }

        is AppRoute.Terminal -> {
            val host = resolveHostForTerminalRoute(currentRoute.hostId)
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
                    fitToScreen = terminalFitToScreen,
                    onFitToScreenChange = { fitToScreen ->
                        terminalFitToScreen = fitToScreen
                        terminalSettingsStore.setTerminalFitToScreen(fitToScreen)
                    },
                    backHint = if (isHostTemporaryTerminal(currentRoute.remotePath, currentRoute.repositoryId)) {
                        TerminalBackClosesSessionHint
                    } else {
                        TerminalBackKeepsSessionHint
                    },
                    terminalSessionManager = terminalSessionManager,
                    terminalForegroundBridge = terminalForegroundBridge,
                    onBack = { activeSessionId ->
                        when {
                            isHostTemporaryTerminal(currentRoute.remotePath, currentRoute.repositoryId) -> {
                                closeHostTemporaryTerminal(activeSessionId ?: currentRoute.terminalSessionId)
                                route = AppRoute.Hosts
                            }
                            currentRoute.repositoryId != null -> {
                                route = AppRoute.Repository(
                                    currentRoute.repositoryId,
                                    terminalWorkspacePath = currentRoute.remotePath,
                                )
                            }
                            else -> route = AppRoute.Diagnostics(host.id)
                        }
                    },
                )
            }
        }

        AppRoute.Settings -> SettingsScreen(
            initialKeepAliveIntervalSeconds = terminalSettingsStore.loadKeepAliveIntervalSeconds(),
            initialHeartbeatFailureThreshold = terminalSettingsStore.loadHeartbeatFailureThreshold(),
            onBack = { route = AppRoute.Hosts },
            onSave = { keepAliveIntervalSeconds, heartbeatFailureThreshold ->
                terminalSettingsStore.setKeepAliveIntervalSeconds(keepAliveIntervalSeconds)
                terminalSettingsStore.setHeartbeatFailureThreshold(heartbeatFailureThreshold)
                route = AppRoute.Hosts
            },
        )
    }
}
