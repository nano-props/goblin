package dev.goblin.android.ui.screens.ports

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSession
import dev.goblin.android.domain.ssh.PortForwardSessionStatus
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.domain.ssh.canCreatePortForward
import dev.goblin.android.ui.theme.GoblinSpacing

internal fun hostPortForwardOwner(host: SshHostProfile): PortForwardOwner =
    PortForwardOwner(id = host.id, label = host.title)

internal fun portForwardSessionsForOwner(
    sessions: List<PortForwardSession>,
    ownerId: String,
): List<PortForwardSession> = sessions.filter { it.owner.id == ownerId }

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

@Composable
internal fun PortForwardPanel(
    title: String,
    emptyText: String,
    sessions: List<PortForwardSession>,
    onStartPortForward: (PortForwardRequest) -> Unit,
    onStopPortForward: (String) -> Unit,
) {
    var remotePort by remember { mutableStateOf("") }
    var localPort by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
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
                Text(title, style = MaterialTheme.typography.titleMedium)
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
            Text(emptyText)
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
