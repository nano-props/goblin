package dev.goblin.android.ui.screens.terminals

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
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
import dev.goblin.android.ui.screens.terminals.terminalWorkspaceCreatedSessions
import dev.goblin.android.terminals.toTerminalSessionState
import dev.goblin.android.ui.theme.GoblinColors
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal val TerminalCommandInputHeight = 40.dp
internal val TerminalActionButtonHeight = 36.dp
private val TerminalCommandInputShape = RoundedCornerShape(6.dp)

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
    var ctrlModifierActive by remember { mutableStateOf(false) }
    var terminalMaximized by remember { mutableStateOf(false) }
    var terminalFontSizeSp by remember { mutableStateOf(TerminalDefaultFontSizeSp) }
    var isSendingQuickInput by remember { mutableStateOf(false) }
    var isSendingCommandInput by remember { mutableStateOf(false) }
    var commandInput by remember(activeSessionId) { mutableStateOf("") }
    var terminalActionMenuExpanded by remember { mutableStateOf(false) }
    var closeConfirmationVisible by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val target = remember(host, remotePath) { RemoteTarget.fromHostProfile(host, remotePath) }
    val workspaceHostId = target.id
    val workspaceHostIds = remember(host.id, workspaceHostId) { setOf(host.id, workspaceHostId) }
    var inputNotice by remember { mutableStateOf<String?>(null) }
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

    fun sendCommandInput() {
        val value = commandInput
        if (value.isEmpty()) return
        sendTerminalInputLocked(
            value = terminalLineInput(value),
            isSending = isSendingCommandInput,
            setSending = { isSendingCommandInput = it },
        ) { sent ->
            if (sent) {
                commandInput = ""
                inputNotice = null
            } else {
                inputNotice = terminalInputUnavailableMessage(terminalState) ?: "Terminal is not connected."
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

    fun requestCloseTerminal() {
        closeConfirmationVisible = true
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
    val emulatorController = activeSessionId?.let { terminalSessionManager.emulatorController(it) }
    val commandInputEnabled = terminalCommandInputEnabled(terminalState) && !isSendingCommandInput

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
            if (terminalTopBarVisible(terminalMaximized)) TopAppBar(
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
                                text = { Text(terminalMaximizeActionLabel(terminalMaximized)) },
                                onClick = {
                                    terminalMaximized = !terminalMaximized
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Font size: ${terminalFontSizeSp}sp") },
                                enabled = false,
                                onClick = {},
                            )
                            DropdownMenuItem(
                                text = { Text("Font smaller") },
                                enabled = terminalFontSizeSp > TerminalMinFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = terminalAdjustedFontSize(terminalFontSizeSp, -1)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Font larger") },
                                enabled = terminalFontSizeSp < TerminalMaxFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = terminalAdjustedFontSize(terminalFontSizeSp, 1)
                                    terminalActionMenuExpanded = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Reset font size") },
                                enabled = terminalFontSizeSp != TerminalDefaultFontSizeSp,
                                onClick = {
                                    terminalFontSizeSp = TerminalDefaultFontSizeSp
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
                                    requestCloseTerminal()
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(GoblinColors.TerminalBackground)
                    .imePadding()
                    .padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                AndroidTerminalViewport(
                    modifier = Modifier.weight(1f),
                    state = terminalState,
                    emulatorController = emulatorController,
                    fitToScreen = fitToScreen,
                    fontSizeSp = terminalFontSizeSp,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CompactCommandInput(
                        modifier = Modifier.weight(1f),
                        value = commandInput,
                        onValueChange = { commandInput = it },
                        enabled = commandInputEnabled,
                        placeholder = terminalCommandInputPlaceholder(terminalState),
                        onSend = { sendCommandInput() },
                    )
                    TerminalTextButton(
                        text = "Send",
                        enabled = commandInputEnabled && commandInput.isNotEmpty(),
                        onClick = { sendCommandInput() },
                    )
                }
                HelperKeyRow(
                    enabled = inputAvailable && !isSendingQuickInput,
                    ctrlModifierActive = ctrlModifierActive,
                    onCtrlToggle = { ctrlModifierActive = !ctrlModifierActive },
                    onCtrlC = { sendControlInput("\u0003") },
                    onCtrlL = { sendControlInput(terminalControlCharacter('L') ?: "\u000C") },
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
                        TerminalTextButton(text = "↑", onClick = { cycleWorkspaceTerminal(-1) })
                        TerminalTextButton(text = "↓", onClick = { cycleWorkspaceTerminal(1) })
                    }
                    if (terminalRestoreInlineActionVisible(terminalMaximized)) {
                        TerminalTextButton(
                            text = "Restore",
                            onClick = { terminalMaximized = false },
                        )
                    }
                    TerminalTextButton(
                        text = "Reconnect",
                        enabled = inlineActions.reconnectEnabled,
                        onClick = { connect() },
                    )
                    TerminalTextButton(
                        text = "Close",
                        enabled = inlineActions.closeEnabled,
                        onClick = { requestCloseTerminal() },
                    )
                }
                inputNotice?.let {
                    Text(
                        text = it,
                        color = GoblinColors.TerminalInputForeground,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }

    if (closeConfirmationVisible) {
        AlertDialog(
            onDismissRequest = { closeConfirmationVisible = false },
            title = { Text("Close terminal?") },
            text = { Text(terminalCloseConfirmationText(screenTitle)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        closeConfirmationVisible = false
                        closeTerminal()
                    },
                ) {
                    Text("Stop and close")
                }
            },
            dismissButton = {
                TextButton(onClick = { closeConfirmationVisible = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

private fun terminalStatusLine(
    host: SshHostProfile,
    remotePath: String,
    state: TerminalSessionState,
): String {
    val status = terminalSessionStatusLabel(state)
    return "${host.title} - ${remotePath.ifBlank { "/" }} - $status"
}

@Composable
private fun CompactCommandInput(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    placeholder: String,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val textColor = if (enabled) {
        GoblinColors.TerminalInputForeground
    } else {
        GoblinColors.TerminalDisabledForeground
    }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodySmall.copy(color = textColor),
        cursorBrush = SolidColor(GoblinColors.TerminalActionForeground),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
        keyboardActions = KeyboardActions(onSend = { onSend() }),
        modifier = modifier
            .height(TerminalCommandInputHeight)
            .background(GoblinColors.TerminalInputBackground, TerminalCommandInputShape)
            .border(1.dp, GoblinColors.TerminalInputBorder, TerminalCommandInputShape),
        decorationBox = { innerTextField ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        color = GoblinColors.TerminalInputPlaceholder,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun TerminalTextButton(
    text: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    TextButton(
        modifier = modifier.height(TerminalActionButtonHeight),
        enabled = enabled,
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(
            contentColor = GoblinColors.TerminalActionForeground,
            disabledContentColor = GoblinColors.TerminalDisabledForeground,
        ),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun HelperKeyRow(
    enabled: Boolean,
    ctrlModifierActive: Boolean,
    onCtrlToggle: () -> Unit,
    onCtrlC: () -> Unit,
    onCtrlL: () -> Unit,
    onEnter: () -> Unit,
    onEsc: () -> Unit,
    onQuickConfirm: () -> Unit,
    onQuickCancel: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
) {
    val labels = terminalHelperKeyLabels(ctrlModifierActive)
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
    ) {
        TerminalTextButton(text = labels[0], enabled = enabled, onClick = onEnter)
        TerminalTextButton(text = labels[1], enabled = enabled, onClick = onQuickConfirm)
        TerminalTextButton(text = labels[2], enabled = enabled, onClick = onQuickCancel)
        TerminalTextButton(text = labels[3], enabled = enabled, onClick = onCtrlC)
        TerminalTextButton(text = labels[4], enabled = enabled, onClick = onCtrlL)
        TerminalTextButton(text = labels[5], enabled = enabled, onClick = onTab)
        TerminalTextButton(text = labels[6], enabled = enabled, onClick = onEsc)
        TerminalTextButton(
            text = labels[7],
            enabled = enabled,
            onClick = onCtrlToggle,
        )
        TerminalTextButton(text = labels[8], enabled = enabled, onClick = { onArrow("\u001b[A") })
        TerminalTextButton(text = labels[9], enabled = enabled, onClick = { onArrow("\u001b[B") })
        TerminalTextButton(text = labels[10], enabled = enabled, onClick = { onArrow("\u001b[D") })
        TerminalTextButton(text = labels[11], enabled = enabled, onClick = { onArrow("\u001b[C") })
        TerminalTextButton(text = labels[12], enabled = enabled, onClick = onPaste)
    }
}
