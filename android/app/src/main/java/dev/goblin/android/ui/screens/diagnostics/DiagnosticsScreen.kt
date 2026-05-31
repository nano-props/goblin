package dev.goblin.android.ui.screens.diagnostics

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.DiagnosticCategory
import dev.goblin.android.domain.ssh.DiagnosticStage
import dev.goblin.android.domain.ssh.DiagnosticStageResult
import dev.goblin.android.domain.ssh.DiagnosticStatus
import dev.goblin.android.domain.ssh.DiagnosticsResult
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsScreen(
    host: SshHostProfile,
    onBack: () -> Unit,
    onOpenTerminal: () -> Unit,
    onRunDiagnostics: () -> DiagnosticsResult,
    onTrustHostKey: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var diagnosticsState: ResourceState<DiagnosticsResult> by remember { mutableStateOf(ResourceState.Idle) }

    fun runDiagnostics() {
        diagnosticsState = ResourceState.Loading
        scope.launch {
            diagnosticsState = runCatching {
                withContext(Dispatchers.IO) { onRunDiagnostics() }
            }.fold(
                onSuccess = { ResourceState.Loaded(it) },
                onFailure = { ResourceState.Error(it.message ?: "Diagnostics failed", it) },
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Host diagnostics") },
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
            Text(host.title, style = MaterialTheme.typography.titleLarge)
            Text(host.subtitle, style = MaterialTheme.typography.bodyMedium)
            Button(onClick = { runDiagnostics() }) {
                Text("Run diagnostics")
            }
            when (val state = diagnosticsState) {
                ResourceState.Idle -> DiagnosticStageList(stages = pendingStages())
                ResourceState.Loading -> DiagnosticStageList(stages = pendingStages(running = DiagnosticStage.SSH))
                is ResourceState.Error -> {
                    Text("failed", color = MaterialTheme.colorScheme.error)
                    Text(state.message)
                    DiagnosticStageList(stages = pendingStages())
                }

                is ResourceState.Stale -> DiagnosticResultContent(
                    result = state.value,
                    onTrustHostKey = onTrustHostKey,
                    onRunDiagnostics = { runDiagnostics() },
                    onOpenTerminal = onOpenTerminal,
                )

                is ResourceState.Loaded -> DiagnosticResultContent(
                    result = state.value,
                    onTrustHostKey = onTrustHostKey,
                    onRunDiagnostics = { runDiagnostics() },
                    onOpenTerminal = onOpenTerminal,
                )
            }
        }
    }
}

@Composable
private fun DiagnosticResultContent(
    result: DiagnosticsResult,
    onTrustHostKey: (String) -> Unit,
    onRunDiagnostics: () -> Unit,
    onOpenTerminal: () -> Unit,
) {
    DiagnosticStageList(stages = result.stages)
    if (result.category == DiagnosticCategory.HostKey && result.hostKeyFingerprint != null) {
        Card(Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                Text(result.message)
                Text(result.hostKeyFingerprint)
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                    Button(
                        onClick = {
                            onTrustHostKey(result.hostKeyFingerprint)
                            onRunDiagnostics()
                        },
                    ) {
                        Text("Trust this host key?")
                    }
                    TextButton(onClick = {}) {
                        Text("Cancel")
                    }
                }
            }
        }
    }
    if (result.ok) {
        Button(onClick = onOpenTerminal) {
            Text("Open terminal")
        }
    }
}

@Composable
private fun DiagnosticStageList(stages: List<DiagnosticStageResult>) {
    val expanded = remember { mutableStateMapOf<DiagnosticStage, Boolean>() }
    Column(verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
        stages.forEach { stage ->
            Card(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(GoblinSpacing.Md),
                    verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(stage.stage.label)
                        Text(stage.status.label)
                    }
                    if (stage.category != null || stage.message.isNotBlank()) {
                        Text(stage.category?.label ?: stage.message, style = MaterialTheme.typography.labelMedium)
                        if (stage.message.isNotBlank()) Text(stage.message)
                    }
                    if (stage.details.isNotBlank()) {
                        TextButton(onClick = { expanded[stage.stage] = expanded[stage.stage] != true }) {
                            Text("Details")
                        }
                        AnimatedVisibility(visible = expanded[stage.stage] == true) {
                            Text(stage.details, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

private fun pendingStages(running: DiagnosticStage? = null): List<DiagnosticStageResult> =
    listOf(
        DiagnosticStage.SSH,
        DiagnosticStage.Shell,
        DiagnosticStage.Git,
        DiagnosticStage.Path,
        DiagnosticStage.Repo,
    ).map { stage ->
        DiagnosticStageResult(
            stage = stage,
            status = if (stage == running) DiagnosticStatus.Running else DiagnosticStatus.Pending,
        )
    }

@Suppress("unused")
private fun targetPreview(): RemoteTarget = RemoteTarget(
    id = "dev@example.com:22/",
    alias = "Dev",
    host = "example.com",
    user = "dev",
    port = 22,
    remotePath = "/",
    identityRefId = null,
)

