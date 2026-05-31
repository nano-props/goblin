package dev.goblin.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.RemoteRepositoryStore
import dev.goblin.android.data.ssh.HostKeyStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshInitializationService
import dev.goblin.android.ssh.SshjInitializationClient
import dev.goblin.android.ssh.SshjClientFacade
import dev.goblin.android.ssh.RemoteRepositoryGitService
import dev.goblin.android.terminal.SshTerminalService
import dev.goblin.android.ui.theme.GoblinTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val hostProfileStore = HostProfileStore.create(this)
        val remoteRepositoryStore = RemoteRepositoryStore.create(this)
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
        val initializationService = SshInitializationService(
            identityStore = secureIdentityStore,
            hostKeyStore = hostKeyStore,
            client = SshjInitializationClient(),
        )
        val terminalService = SshTerminalService(
            identityStore = secureIdentityStore,
            hostKeyTrustStore = hostKeyStore,
        )
        setContent {
            GoblinTheme {
                GoblinAndroidApp(
                    hostProfileStore = hostProfileStore,
                    remoteRepositoryStore = remoteRepositoryStore,
                    secureIdentityStore = secureIdentityStore,
                    diagnosticsService = diagnosticsService,
                    remoteRepositoryGitService = remoteRepositoryGitService,
                    initializationService = initializationService,
                    terminalService = terminalService,
                )
            }
        }
    }
}
