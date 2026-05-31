package dev.goblin.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dev.goblin.android.data.HostProfileStore
import dev.goblin.android.data.ssh.HostKeyStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.ssh.SshDiagnosticsService
import dev.goblin.android.ssh.SshjClientFacade
import dev.goblin.android.terminal.SshTerminalService
import dev.goblin.android.ui.theme.GoblinTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val hostProfileStore = HostProfileStore.create(this)
        val secureIdentityStore = SecureIdentityStore.create(this)
        val hostKeyStore = HostKeyStore.create(this)
        val diagnosticsService = SshDiagnosticsService(
            client = SshjClientFacade(identityStore = secureIdentityStore),
            hostKeyStore = hostKeyStore,
        )
        val terminalService = SshTerminalService(
            identityStore = secureIdentityStore,
            hostKeyTrustStore = hostKeyStore,
        )
        setContent {
            GoblinTheme {
                GoblinAndroidApp(
                    hostProfileStore = hostProfileStore,
                    secureIdentityStore = secureIdentityStore,
                    hostKeyStore = hostKeyStore,
                    diagnosticsService = diagnosticsService,
                    terminalService = terminalService,
                )
            }
        }
    }
}
