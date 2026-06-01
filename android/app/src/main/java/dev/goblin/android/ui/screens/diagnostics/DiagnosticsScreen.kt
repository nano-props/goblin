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
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.DiagnosticCategory
import dev.goblin.android.domain.ssh.DiagnosticStage
import dev.goblin.android.domain.ssh.DiagnosticStageResult
import dev.goblin.android.domain.ssh.DiagnosticStatus
import dev.goblin.android.domain.ssh.DiagnosticsResult
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSession
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ssh.SshInitializationCheck
import dev.goblin.android.ui.screens.ports.PortForwardPanel
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
    onCheckSshInitialization: () -> SshInitializationCheck = { SshInitializationCheck.Ready },
    onInitializeSshAccess: (CharArray) -> Unit = {},
    onRunDiagnostics: () -> DiagnosticsResult,
    onTrustHostKey: (String) -> Unit,
    portForwardSessions: List<PortForwardSession> = emptyList(),
    onStartPortForward: (PortForwardRequest) -> PortForwardSession = {
        throw UnsupportedOperationException("Port forwarding is not available")
    },
    onStopPortForward: (String) -> PortForwardSession? = { null },
) {
    val scope = rememberCoroutineScope()
    var diagnosticsState: ResourceState<DiagnosticsResult> by remember { mutableStateOf(ResourceState.Idle) }
    var initializationCheck: SshInitializationCheck? by remember { mutableStateOf(null) }
    var initializationPassword by remember { mutableStateOf("") }
    var initializationError by remember { mutableStateOf<String?>(null) }

    fun runDiagnostics() {
        diagnosticsState = ResourceState.Loading
        scope.launch {
            val ready = runCatching {
                withContext(Dispatchers.IO) { onCheckSshInitialization() }
            }.getOrElse {
                diagnosticsState = ResourceState.Error(it.message ?: "SSH initialization check failed", it)
                return@launch
            }
            if (ready != SshInitializationCheck.Ready) {
                initializationCheck = ready
                diagnosticsState = ResourceState.Idle
                return@launch
            }
            initializationCheck = null
            diagnosticsState = runCatching {
                withContext(Dispatchers.IO) { onRunDiagnostics() }
            }.fold(
                onSuccess = { ResourceState.Loaded(it) },
                onFailure = { ResourceState.Error(it.message ?: "Diagnostics failed", it) },
            )
        }
    }

    fun refreshInitializationCheck() {
        scope.launch {
            initializationCheck = runCatching {
                withContext(Dispatchers.IO) { onCheckSshInitialization() }
            }.getOrElse {
                initializationError = it.message ?: "SSH initialization check failed"
                null
            }
        }
    }

    fun initializeSshAccess() {
        val password = initializationPassword.toCharArray()
        initializationError = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { onInitializeSshAccess(password) }
            }.onSuccess {
                initializationPassword = ""
                initializationCheck = null
                runDiagnostics()
            }.onFailure {
                initializationPassword = ""
                initializationError = it.message ?: "SSH initialization failed"
            }
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
            initializationCheck?.let { check ->
                SshInitializationCard(
                    check = check,
                    password = initializationPassword,
                    error = initializationError,
                    onPasswordChange = { initializationPassword = it },
                    onTrustHostKey = {
                        onTrustHostKey(it)
                        refreshInitializationCheck()
                    },
                    onInitialize = { initializeSshAccess() },
                )
            }
            Button(onClick = { runDiagnostics() }) {
                Text("Run diagnostics")
            }
            HostPortsSection(
                sessions = portForwardSessions,
                onStartPortForward = onStartPortForward,
                onStopPortForward = onStopPortForward,
            )
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
private fun SshInitializationCard(
    check: SshInitializationCheck,
    password: String,
    error: String?,
    onPasswordChange: (String) -> Unit,
    onTrustHostKey: (String) -> Unit,
    onInitialize: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
        ) {
            when (check) {
                SshInitializationCheck.Ready -> Text("SSH access is initialized.")
                is SshInitializationCheck.NeedsHostKeyTrust -> {
                    Text("Trust this host key before initializing SSH access.")
                    Text(check.fingerprint, style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { onTrustHostKey(check.fingerprint) }) {
                        Text("Trust host key")
                    }
                }
                SshInitializationCheck.NeedsServerPassword -> {
                    Text("Enter the temporary server password to install Goblin Android's public key.")
                    OutlinedTextField(
                        modifier = Modifier.fillMaxWidth(),
                        value = password,
                        onValueChange = onPasswordChange,
                        label = { Text("Temporary password") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Button(
                        enabled = password.isNotEmpty(),
                        onClick = onInitialize,
                    ) {
                        Text("Initialize SSH access")
                    }
                }
                is SshInitializationCheck.HostKeyChanged -> {
                    Text(
                        "Host key changed. Review this server before trusting it again.",
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text("Previous: ${check.previousFingerprint}", style = MaterialTheme.typography.bodySmall)
                    Text("Current: ${check.currentFingerprint}", style = MaterialTheme.typography.bodySmall)
                }
            }
            if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun HostPortsSection(
    sessions: List<PortForwardSession>,
    onStartPortForward: (PortForwardRequest) -> PortForwardSession,
    onStopPortForward: (String) -> PortForwardSession?,
) {
    val scope = rememberCoroutineScope()
    var visiblePortForwards by remember(sessions) { mutableStateOf(sessions) }
    var error by remember { mutableStateOf<String?>(null) }

    fun upsertPortForwardSession(session: PortForwardSession) {
        visiblePortForwards = visiblePortForwards.filterNot { it.id == session.id } + session
    }

    PortForwardPanel(
        title = "Ports",
        emptyText = "No port forwards for this host.",
        sessions = visiblePortForwards,
        onStartPortForward = { request ->
            error = null
            scope.launch {
                runCatching { withContext(Dispatchers.IO) { onStartPortForward(request) } }
                    .onSuccess(::upsertPortForwardSession)
                    .onFailure { error = it.message ?: "Port forward failed" }
            }
        },
        onStopPortForward = { sessionId ->
            error = null
            scope.launch {
                runCatching { withContext(Dispatchers.IO) { onStopPortForward(sessionId) } }
                    .onSuccess { session -> if (session != null) upsertPortForwardSession(session) }
                    .onFailure { error = it.message ?: "Stop port forward failed" }
            }
        },
    )
    if (error != null) {
        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
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
