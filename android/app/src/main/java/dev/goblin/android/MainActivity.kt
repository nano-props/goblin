package dev.goblin.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.RemoteRepositoryStore
import dev.goblin.android.data.TerminalSessionStore
import dev.goblin.android.data.ssh.HostKeyStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshInitializationService
import dev.goblin.android.ssh.SshjInitializationClient
import dev.goblin.android.ssh.SshjClientFacade
import dev.goblin.android.ssh.RemoteRepositoryGitService
import dev.goblin.android.ssh.RemoteWorktreeService
import dev.goblin.android.ssh.PortForwardManager
import dev.goblin.android.ssh.SshjPortForwardBackend
import dev.goblin.android.terminal.AndroidTerminalForegroundOwner
import dev.goblin.android.terminal.SshTerminalService
import dev.goblin.android.terminal.TerminalForegroundBridge
import dev.goblin.android.terminal.TerminalNavigationRequest
import dev.goblin.android.terminal.TerminalSessionIntentExtra
import dev.goblin.android.terminal.TerminalSessionRuntime
import dev.goblin.android.ui.theme.GoblinTheme

class MainActivity : ComponentActivity() {
    private val terminalNavigationRequest = mutableStateOf<TerminalNavigationRequest?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deliverTerminalNavigationIntent(intent)
        val hostProfileStore = HostProfileStore.create(this)
        val remoteRepositoryStore = RemoteRepositoryStore.create(this)
        val terminalSessionStore = TerminalSessionStore.create(this)
        val secureIdentityStore = SecureIdentityStore.create(this)
        val hostKeyStore = HostKeyStore.create(this)
        val diagnosticsService = SshDiagnosticsService(
            client = SshjClientFacade(identityStore = secureIdentityStore),
            hostKeyStore = hostKeyStore,
        )
        val remoteRepositoryGitService = RemoteRepositoryGitService(
            client = SshjClientFacade(identityStore = secureIdentityStore),
            hostKeyStore = hostKeyStore,
        )
        val remoteWorktreeService = RemoteWorktreeService(
            client = SshjClientFacade(identityStore = secureIdentityStore),
            hostKeyStore = hostKeyStore,
        )
        val portForwardManager = PortForwardManager(
            backend = SshjPortForwardBackend(
                identityStore = secureIdentityStore,
                hostKeyTrustStore = hostKeyStore,
            ),
        )
        val initializationService = SshInitializationService(
            identityStore = secureIdentityStore,
            hostKeyStore = hostKeyStore,
            client = SshjInitializationClient(),
        )
        val terminalService = SshTerminalService(
            identityStore = secureIdentityStore,
            hostKeyTrustStore = hostKeyStore,
        )
        val terminalManager = TerminalSessionRuntime.manager(
            terminalService = terminalService,
            sessionStore = terminalSessionStore,
        )
        val terminalForegroundBridge = TerminalForegroundBridge(
            manager = terminalManager,
            owner = AndroidTerminalForegroundOwner(this),
        )
        setContent {
            GoblinTheme {
                GoblinAndroidApp(
                    hostProfileStore = hostProfileStore,
                    remoteRepositoryStore = remoteRepositoryStore,
                    secureIdentityStore = secureIdentityStore,
                    diagnosticsService = diagnosticsService,
                    remoteRepositoryGitService = remoteRepositoryGitService,
                    remoteWorktreeService = remoteWorktreeService,
                    portForwardManager = portForwardManager,
                    initializationService = initializationService,
                    terminalSessionManager = terminalManager,
                    terminalForegroundBridge = terminalForegroundBridge,
                    terminalNavigationRequest = terminalNavigationRequest.value,
                )
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deliverTerminalNavigationIntent(intent)
    }

    private fun deliverTerminalNavigationIntent(intent: android.content.Intent?) {
        val sessionId = intent?.getStringExtra(TerminalSessionIntentExtra) ?: return
        val nextSequence = (terminalNavigationRequest.value?.sequence ?: 0L) + 1L
        terminalNavigationRequest.value = TerminalNavigationRequest(
            sessionId = sessionId,
            sequence = nextSequence,
        )
    }
}
