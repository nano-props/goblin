package dev.goblin.android.ui.screens.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.terminal.TerminalForegroundBridge
import dev.goblin.android.terminal.TerminalSessionManager
import dev.goblin.android.terminal.TerminalSessionState
import dev.goblin.android.terminal.toTerminalSessionState
import dev.goblin.android.ui.theme.GoblinColors
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    host: SshHostProfile,
    remotePath: String = "/",
    repositoryId: String? = null,
    targetLabel: String = terminalTargetLabel(host.title, remotePath),
    backHint: String = TerminalBackKeepsSessionHint,
    terminalSessionId: String? = null,
    terminalSessionManager: TerminalSessionManager,
    terminalForegroundBridge: TerminalForegroundBridge,
    onBack: () -> Unit,
) {
    var terminalState: TerminalSessionState by remember { mutableStateOf(TerminalSessionState.Idle) }
    var activeSessionId by remember(host, remotePath, repositoryId, terminalSessionId) {
        mutableStateOf(terminalSessionId)
    }
    var input by remember { mutableStateOf("") }
    var ctrlModifierActive by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val target = remember(host, remotePath) { RemoteTarget.fromHostProfile(host, remotePath) }
    var inputNotice by remember { mutableStateOf<String?>(null) }
    var stickToBottom by remember { mutableStateOf(true) }
    val inputAvailable = terminalInputAvailable(terminalState)

    fun connect() {
        scope.launch {
            val record = withContext(Dispatchers.IO) {
                terminalSessionManager.createOrAttach(
                    target = target,
                    repositoryId = repositoryId,
                    targetLabel = targetLabel,
                )
            }
            activeSessionId = record.id
            terminalState = record.toTerminalSessionState()
            terminalForegroundBridge.sync()
        }
    }

    fun sendTerminalInput(value: String, onResult: (Boolean) -> Unit = {}) {
        scope.launch {
            val sessionId = activeSessionId
            val sent = withContext(Dispatchers.IO) {
                sessionId?.let { terminalSessionManager.sendInput(it, value) } ?: false
            }
            terminalForegroundBridge.sync()
            onResult(sent)
        }
    }

    fun closeTerminal() {
        scope.launch {
            val sessionId = activeSessionId
            withContext(Dispatchers.IO) {
                if (sessionId != null) terminalSessionManager.close(sessionId)
            }
            terminalForegroundBridge.sync()
        }
    }

    fun sendControlInput(value: String) {
        sendTerminalInput(value) { sent ->
            inputNotice = if (sent) null else "Terminal is not connected."
        }
        ctrlModifierActive = false
    }

    fun submitInput() {
        val unavailable = terminalInputUnavailableMessage(terminalState)
        if (unavailable != null) {
            inputNotice = unavailable
            return
        }
        val value = input
        if (value.isEmpty()) return
        sendTerminalInput(terminalLineInput(value)) { sent ->
            inputNotice = if (sent) {
                input = ""
                null
            } else {
                "Terminal is not connected."
            }
        }
    }

    DisposableEffect(activeSessionId) {
        val sessionId = activeSessionId
        if (sessionId == null) {
            onDispose { }
        } else {
            val observer = terminalSessionManager.observe(sessionId) { record ->
                scope.launch {
                    terminalState = record.toTerminalSessionState()
                    terminalForegroundBridge.sync()
                }
            }
            onDispose {
                observer.close()
            }
        }
    }

    LaunchedEffect(target, repositoryId, targetLabel, terminalSessionId) {
        val record = withContext(Dispatchers.IO) {
            terminalSessionId
                ?.let { terminalSessionManager.session(it) }
                ?: terminalSessionManager.createOrAttach(
                    target = target,
                    repositoryId = repositoryId,
                    targetLabel = targetLabel,
                )
        }
        activeSessionId = record.id
        terminalState = record.toTerminalSessionState()
        terminalForegroundBridge.sync()
    }

    LaunchedEffect(terminalState) {
        inputNotice = terminalInputUnavailableMessage(terminalState)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = targetLabel,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = backHint,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                        )
                    }
                },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("Back")
                    }
                },
            )
        },
    ) { padding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            val cols = (maxWidth.value / 8f).roundToInt().coerceIn(20, 180)
            val rows = (maxHeight.value / 18f).roundToInt().coerceIn(6, 80)
            LaunchedEffect(activeSessionId, cols, rows) {
                val sessionId = activeSessionId
                withContext(Dispatchers.IO) {
                    if (sessionId != null) terminalSessionManager.resize(sessionId, cols, rows)
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(GoblinColors.TerminalBackground)
                    .imePadding()
                    .padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                TerminalStatusStrip(
                    host = host,
                    remotePath = remotePath,
                    state = terminalState,
                    followOutput = stickToBottom,
                    onFollowOutputChange = { stickToBottom = it },
                )
                TerminalViewport(
                    modifier = Modifier.weight(1f),
                    state = terminalState,
                    stickToBottom = stickToBottom,
                    onStickToBottomChange = { stickToBottom = it },
                )
                HelperKeyRow(
                    enabled = inputAvailable,
                    ctrlModifierActive = ctrlModifierActive,
                    onCtrlToggle = { ctrlModifierActive = !ctrlModifierActive },
                    onCtrlC = { sendControlInput("\u0003") },
                    onEsc = { sendTerminalInput("\u001b") },
                    onTab = { sendTerminalInput("\t") },
                    onArrow = { code -> sendTerminalInput(code) },
                    onPaste = {
                        val unavailable = terminalInputUnavailableMessage(terminalState)
                        if (unavailable != null) {
                            inputNotice = unavailable
                            return@HelperKeyRow
                        }
                        scope.launch {
                            val text = clipboard.getClipEntry()
                                ?.clipData
                                ?.getItemAt(0)
                                ?.coerceToText(context)
                                ?.toString()
                                .orEmpty()
                            val pasted = withContext(Dispatchers.IO) {
                                activeSessionId?.let { terminalSessionManager.paste(it, text) } ?: false
                            }
                            terminalForegroundBridge.sync()
                            inputNotice = if (pasted) null else "Terminal is not connected."
                        }
                    },
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
                ) {
                    BasicTextField(
                        modifier = Modifier
                            .weight(1f)
                            .background(MaterialTheme.colorScheme.surface)
                            .padding(GoblinSpacing.Sm)
                            .onPreviewKeyEvent { event ->
                                if (!inputAvailable) return@onPreviewKeyEvent false
                                val control = terminalControlInput(
                                    keyCode = event.nativeKeyEvent.keyCode,
                                    ctrlPressed = event.nativeKeyEvent.isCtrlPressed,
                                    action = event.nativeKeyEvent.action,
                                ) ?: return@onPreviewKeyEvent false
                                sendControlInput(control)
                                true
                            },
                        enabled = inputAvailable,
                        value = input,
                        onValueChange = { next ->
                            if (ctrlModifierActive && next.length == input.length + 1) {
                                terminalControlCharacter(next.last())?.let { control ->
                                    sendControlInput(control)
                                    return@BasicTextField
                                }
                            }
                            ctrlModifierActive = false
                            input = next
                            inputNotice = null
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { submitInput() }),
                        singleLine = true,
                        textStyle = TextStyle(
                            color = MaterialTheme.colorScheme.onSurface,
                            fontFamily = FontFamily.Monospace,
                        ),
                    )
                    Button(
                        enabled = inputAvailable && input.isNotEmpty(),
                        onClick = { submitInput() },
                    ) {
                        Text("Send")
                    }
                }
                inputNotice?.let {
                    Text(
                        text = it,
                        color = GoblinColors.TerminalForeground,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                    Button(
                        enabled = terminalReconnectAvailable(terminalState),
                        onClick = { connect() },
                    ) {
                        Text("Reconnect")
                    }
                    TextButton(onClick = { closeTerminal() }) {
                        Text("Close")
                    }
                }
            }
        }
    }
}

@Composable
private fun TerminalStatusStrip(
    host: SshHostProfile,
    remotePath: String,
    state: TerminalSessionState,
    followOutput: Boolean,
    onFollowOutputChange: (Boolean) -> Unit,
) {
    val status = when (state) {
        TerminalSessionState.Idle -> "idle"
        TerminalSessionState.Connecting -> "connecting"
        is TerminalSessionState.Connected -> "connected"
        is TerminalSessionState.Resizing -> "resizing"
        is TerminalSessionState.Exited -> "exited"
        is TerminalSessionState.Failed -> "failed"
        is TerminalSessionState.Disconnected -> "disconnected"
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            modifier = Modifier.weight(1f),
            text = "${host.title} - ${remotePath.ifBlank { "/" }} - $status",
            color = GoblinColors.TerminalForeground,
            style = MaterialTheme.typography.labelMedium,
        )
        TextButton(onClick = { onFollowOutputChange(!followOutput) }) {
            Text(if (followOutput) "Following" else "Follow output")
        }
    }
}

@Composable
private fun TerminalViewport(
    modifier: Modifier = Modifier,
    state: TerminalSessionState,
    stickToBottom: Boolean,
    onStickToBottomChange: (Boolean) -> Unit,
) {
    val output = terminalViewportText(state)
    val banner = terminalSessionBannerMessage(state)
    val verticalScrollState = rememberScrollState()
    val horizontalScrollState = rememberScrollState()

    LaunchedEffect(verticalScrollState) {
        snapshotFlow { verticalScrollState.value to verticalScrollState.maxValue }
            .collect { (value, max) ->
                if (stickToBottom) return@collect
                onStickToBottomChange(terminalStickToBottom(value, max))
            }
    }

    LaunchedEffect(output, stickToBottom) {
        if (!stickToBottom) return@LaunchedEffect
        verticalScrollState.scrollTo(verticalScrollState.maxValue)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(GoblinColors.TerminalBackground),
    ) {
        Text(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(verticalScrollState)
                .horizontalScroll(horizontalScrollState),
            text = output,
            color = GoblinColors.TerminalForeground,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodyMedium,
        )
        banner?.let { message ->
            Text(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f))
                    .padding(GoblinSpacing.Sm),
                text = message,
                color = GoblinColors.TerminalForeground,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun HelperKeyRow(
    enabled: Boolean,
    ctrlModifierActive: Boolean,
    onCtrlToggle: () -> Unit,
    onCtrlC: () -> Unit,
    onEsc: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
    ) {
        TextButton(enabled = enabled, onClick = onEsc) { Text("Esc") }
        TextButton(enabled = enabled, onClick = onCtrlToggle) {
            Text(if (ctrlModifierActive) "Ctrl on" else "Ctrl")
        }
        TextButton(enabled = enabled, onClick = onCtrlC) { Text("Ctrl+C") }
        TextButton(enabled = enabled, onClick = onTab) { Text("Tab") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[A") }) { Text("Up") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[B") }) { Text("Down") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[D") }) { Text("Left") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[C") }) { Text("Right") }
        TextButton(enabled = enabled, onClick = onPaste) { Text("Paste") }
    }
}
