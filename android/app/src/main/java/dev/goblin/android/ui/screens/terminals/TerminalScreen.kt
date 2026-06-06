package dev.goblin.android.ui.screens.terminals

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.core.content.ContextCompat
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.notifications.NotificationPermissionPolicy
import dev.goblin.android.terminals.TerminalForegroundBridge
import dev.goblin.android.terminals.TerminalSessionManager
import dev.goblin.android.terminals.TerminalSessionState
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.terminals.TerminalSessionDefaults
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceCreatedSessions
import dev.goblin.android.terminals.toTerminalSessionState
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
    fitToScreen: Boolean,
    onFitToScreenChange: (Boolean) -> Unit,
    onBack: (String?) -> Unit,
) {
    var terminalState: TerminalSessionState by remember { mutableStateOf(TerminalSessionState.Idle) }
    var activeSessionId by remember(host, remotePath, repositoryId, terminalSessionId) {
        mutableStateOf(terminalSessionId)
    }
    var terminalSessions by remember { mutableStateOf(terminalSessionManager.sessions()) }
    var input by remember { mutableStateOf("") }
    var ctrlModifierActive by remember { mutableStateOf(false) }
    var terminalMaximized by remember { mutableStateOf(false) }
    var isSendingQuickInput by remember { mutableStateOf(false) }
    var isSendingSubmitInput by remember { mutableStateOf(false) }
    var terminalActionMenuExpanded by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val target = remember(host, remotePath) { RemoteTarget.fromHostProfile(host, remotePath) }
    val workspaceHostId = target.id
    val workspaceHostIds = remember(host.id, workspaceHostId) { setOf(host.id, workspaceHostId) }
    var inputNotice by remember { mutableStateOf<String?>(null) }
    var stickToBottom by remember { mutableStateOf(true) }
    var notificationPermissionRequested by remember { mutableStateOf(false) }
    val inputAvailable = terminalInputAvailable(terminalState)
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        terminalForegroundBridge.sync()
    }
    val activeTerminalPath = remotePath.ifBlank { "/" }

    fun syncTerminalForeground() {
        val permissionGranted = ContextCompat.checkSelfPermission(
            context,
            NotificationPermissionPolicy.Permission,
        ) == PackageManager.PERMISSION_GRANTED
        val hasRunningTerminal = terminalSessionManager.sessions().any { it.status == TerminalSessionStatus.Running }
        if (
            !notificationPermissionRequested &&
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = Build.VERSION.SDK_INT,
                permissionGranted = permissionGranted,
                foregroundNotificationNeeded = hasRunningTerminal,
            )
        ) {
            notificationPermissionRequested = true
            notificationPermissionLauncher.launch(NotificationPermissionPolicy.Permission)
        }
        terminalForegroundBridge.sync()
    }

    fun connect() {
        scope.launch {
            val record = withContext(Dispatchers.IO) {
                val sessionId = activeSessionId
                if (sessionId != null && terminalReconnectAvailable(terminalState)) {
                    terminalSessionManager.reconnect(
                        sessionId = sessionId,
                        target = target,
                        repositoryId = repositoryId,
                        targetLabel = targetLabel,
                    )
                } else {
                    terminalSessionManager.createOrAttach(
                        target = target,
                        repositoryId = repositoryId,
                        targetLabel = targetLabel,
                    )
                }
            }
            if (record != null) {
                activeSessionId = record.id
                terminalState = record.toTerminalSessionState()
            }
            syncTerminalForeground()
        }
    }

    fun sendTerminalInputLocked(
        value: String,
        isSending: Boolean,
        setSending: (Boolean) -> Unit,
        onResult: (Boolean) -> Unit = {},
    ) {
        if (isSending) return
        setSending(true)
        scope.launch {
            val sent = try {
                val sessionId = activeSessionId
                withContext(Dispatchers.IO) {
                    sessionId?.let { terminalSessionManager.sendInput(it, value) } ?: false
                }
            } catch (_: Exception) {
                false
            }
            syncTerminalForeground()
            setSending(false)
            onResult(sent)
        }
    }

    fun sendQuickInput(value: String) {
        sendTerminalInputLocked(
            value = terminalQuickInput(value),
            isSending = isSendingQuickInput,
            setSending = { isSendingQuickInput = it },
        ) { sent ->
            inputNotice = if (sent) null else "Terminal is not connected."
        }
    }

    fun submitInput() {
        if (isSendingSubmitInput) return
        val unavailable = terminalInputUnavailableMessage(terminalState)
        if (unavailable != null) {
            inputNotice = unavailable
            return
        }
        val value = input
        if (value.isEmpty()) return
        sendTerminalInputLocked(
            value = terminalLineInput(value),
            isSending = isSendingSubmitInput,
            setSending = { isSendingSubmitInput = it },
        ) { sent ->
            inputNotice = if (sent) {
                input = ""
                null
            } else {
                "Terminal is not connected."
            }
        }
    }

    fun closeTerminal() {
        scope.launch {
            val sessionId = activeSessionId
            withContext(Dispatchers.IO) {
                if (sessionId != null) terminalSessionManager.close(sessionId)
            }
            syncTerminalForeground()
            onBack(sessionId)
        }
    }

    fun sendControlInput(value: String) {
        sendTerminalInputLocked(
            value = value,
            isSending = false,
            setSending = { _ -> },
        ) { sent ->
            inputNotice = if (sent) null else "Terminal is not connected."
        }
        ctrlModifierActive = false
    }

    fun switchToSession(targetSessionId: String) {
        if (targetSessionId == activeSessionId) return
        val targetSession = terminalSessionManager.session(targetSessionId) ?: return
        activeSessionId = targetSessionId
        terminalState = targetSession.toTerminalSessionState()
    }

    fun cycleWorkspaceTerminal(direction: Int) {
        val availableSessions = terminalWorkspaceCreatedSessions(
            sessions = terminalSessions,
            hostIds = workspaceHostIds,
            remotePath = activeTerminalPath,
        )
        if (availableSessions.size <= 1) return
        val currentIndex = availableSessions.indexOfFirst { it.id == activeSessionId }.takeIf { it >= 0 } ?: 0
        val nextIndex = (currentIndex + direction).mod(availableSessions.size)
        switchToSession(availableSessions[nextIndex].id)
    }

    DisposableEffect(activeSessionId) {
        val sessionId = activeSessionId
        if (sessionId == null) {
            onDispose { }
        } else {
            val observer = terminalSessionManager.observe(sessionId) { record ->
                scope.launch {
                    terminalState = record.toTerminalSessionState()
                    syncTerminalForeground()
                }
            }
            onDispose {
                observer.close()
            }
        }
    }

    DisposableEffect(terminalSessionManager) {
        val observer = terminalSessionManager.observeSessions { sessions ->
            scope.launch {
                terminalSessions = sessions
            }
        }
        onDispose { observer.close() }
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
        syncTerminalForeground()
    }

    LaunchedEffect(terminalState) {
        inputNotice = terminalInputUnavailableMessage(terminalState)
    }

    LaunchedEffect(terminalSessions, activeSessionId, workspaceHostIds, activeTerminalPath) {
        val workspaceSessions = terminalWorkspaceCreatedSessions(
            sessions = terminalSessions,
            hostIds = workspaceHostIds,
            remotePath = activeTerminalPath,
        )
        val workspaceSession = workspaceSessions.maxByOrNull { it.openedAt }
        val fallbackSession = workspaceSession ?: terminalSessions.maxByOrNull { it.openedAt }
        if (activeSessionId == null && fallbackSession != null) {
            switchToSession(fallbackSession.id)
        } else if (activeSessionId != null && terminalSessions.none { it.id == activeSessionId }) {
            if (fallbackSession != null) {
                switchToSession(fallbackSession.id)
            } else {
                activeSessionId = null
                terminalState = TerminalSessionState.Idle
            }
        }
    }

    val screenTitle = terminalScreenTitle(
        sessionId = activeSessionId,
        sessions = terminalSessions,
        hostIds = workspaceHostIds,
        remotePath = remotePath,
    )
    val workspaceSessions = terminalWorkspaceCreatedSessions(
        sessions = terminalSessions,
        hostIds = workspaceHostIds,
        remotePath = activeTerminalPath,
    )
    val hasWorkspaceSwitchTargets = workspaceSessions.size > 1
    val inlineActions = terminalDetailInlineActions(terminalState)
    val topBarInfo = terminalStatusLine(host = host, remotePath = remotePath, state = terminalState)

    val navigateBack = {
        if (terminalMaximized) {
            terminalMaximized = false
        } else {
            onBack(activeSessionId)
        }
    }

    BackHandler {
        navigateBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                modifier = Modifier.height(56.dp),
                title = {
                    Column {
                        Text(
                            text = screenTitle,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            text = topBarInfo,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                navigationIcon = {
                    TextButton(onClick = { navigateBack() }) {
                        Text("BACK")
                    }
                },
                actions = {
                    Box {
                        TextButton(onClick = { terminalActionMenuExpanded = true }) {
                            Text("⋮")
                        }
                        DropdownMenu(
                            expanded = terminalActionMenuExpanded,
                            onDismissRequest = { terminalActionMenuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Text(if (stickToBottom) "Following output" else "Follow output")
                                },
                                onClick = {
                                    stickToBottom = !stickToBottom
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (fitToScreen) "Original width" else "Fit to screen width",
                                    )
                                },
                                onClick = {
                                    onFitToScreenChange(!fitToScreen)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(if (terminalMaximized) "Restore" else "Maximize") },
                                onClick = {
                                    terminalMaximized = !terminalMaximized
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Reconnect terminal") },
                                enabled = terminalReconnectAvailable(terminalState),
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    if (terminalReconnectAvailable(terminalState)) {
                                        connect()
                                    }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Close terminal") },
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    closeTerminal()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Back") },
                                onClick = {
                                    terminalActionMenuExpanded = false
                                    navigateBack()
                                },
                            )
                        }
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
            val cols = if (fitToScreen) {
                (maxWidth.value / 8f).roundToInt().coerceIn(20, 180)
            } else {
                TerminalSessionDefaults.Cols
            }
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
                TerminalViewport(
                    modifier = Modifier.weight(1f),
                    state = terminalState,
                    stickToBottom = stickToBottom,
                    fitToScreen = fitToScreen,
                    onStickToBottomChange = { stickToBottom = it },
                )
                HelperKeyRow(
                    enabled = inputAvailable && !isSendingQuickInput && !isSendingSubmitInput,
                    ctrlModifierActive = ctrlModifierActive,
                    onCtrlToggle = { ctrlModifierActive = !ctrlModifierActive },
                    onCtrlC = { sendControlInput("\u0003") },
                    onEnter = { sendTerminalInputLocked("\r", false, { _ -> }) },
                    onEsc = { sendTerminalInputLocked("\u001b", false, { _ -> }) },
                    onQuickConfirm = { sendQuickInput(TerminalQuickConfirmInput) },
                    onQuickCancel = { sendQuickInput(TerminalQuickCancelInput) },
                    onTab = { sendTerminalInputLocked("\t", false, { _ -> }) },
                    onArrow = { code -> sendTerminalInputLocked(code, false, { _ -> }) },
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
                            syncTerminalForeground()
                            inputNotice = if (pasted) null else "Terminal is not connected."
                        }
                    },
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                ) {
                    if (hasWorkspaceSwitchTargets) {
                        TextButton(onClick = { cycleWorkspaceTerminal(-1) }) {
                            Text("↑")
                        }
                        TextButton(onClick = { cycleWorkspaceTerminal(1) }) {
                            Text("↓")
                        }
                    }
                    TextButton(
                        enabled = inlineActions.reconnectEnabled,
                        onClick = { connect() },
                    ) {
                        Text("Reconnect")
                    }
                    TextButton(
                        enabled = inlineActions.closeEnabled,
                        onClick = { closeTerminal() },
                    ) {
                        Text("Close")
                    }
                }
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
                        enabled = inputAvailable && input.isNotEmpty() && !isSendingSubmitInput && !isSendingQuickInput,
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
            }
        }
    }
}

private fun terminalStatusLine(
    host: SshHostProfile,
    remotePath: String,
    state: TerminalSessionState,
): String {
    val status = when (state) {
        TerminalSessionState.Idle -> "idle"
        TerminalSessionState.Connecting -> "connecting"
        is TerminalSessionState.Connected -> "connected"
        is TerminalSessionState.Resizing -> "resizing"
        is TerminalSessionState.Exited -> "exited"
        is TerminalSessionState.Failed -> "failed"
        is TerminalSessionState.Disconnected -> "disconnected"
    }
    return "${host.title} - ${remotePath.ifBlank { "/" }} - $status"
}

@Composable
private fun TerminalViewport(
    modifier: Modifier = Modifier,
    state: TerminalSessionState,
    stickToBottom: Boolean,
    fitToScreen: Boolean,
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
        val viewportModifier = if (fitToScreen) {
            Modifier
                .fillMaxSize()
                .verticalScroll(verticalScrollState)
        } else {
            Modifier
                .fillMaxWidth()
                .horizontalScroll(horizontalScrollState)
                .verticalScroll(verticalScrollState)
        }
        Text(
            modifier = viewportModifier,
            text = output,
            color = GoblinColors.TerminalForeground,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodyMedium,
            softWrap = fitToScreen,
            overflow = TextOverflow.Clip,
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
    onEnter: () -> Unit,
    onEsc: () -> Unit,
    onQuickConfirm: () -> Unit,
    onQuickCancel: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
    ) {
        TextButton(enabled = enabled, onClick = onEnter) { Text("ENTER") }
        TextButton(enabled = enabled, onClick = onQuickConfirm) { Text("YES") }
        TextButton(enabled = enabled, onClick = onQuickCancel) { Text("NO") }
        TextButton(enabled = enabled, onClick = onCtrlC) { Text("CTRL+C") }
        TextButton(enabled = enabled, onClick = onTab) { Text("Tab") }
        TextButton(enabled = enabled, onClick = onEsc) { Text("Esc") }
        TextButton(enabled = enabled, onClick = onCtrlToggle) {
            Text(if (ctrlModifierActive) "Ctrl on" else "Ctrl")
        }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[A") }) { Text("Up") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[B") }) { Text("Down") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[D") }) { Text("Left") }
        TextButton(enabled = enabled, onClick = { onArrow("\u001b[C") }) { Text("Right") }
        TextButton(enabled = enabled, onClick = onPaste) { Text("Paste") }
    }
}
