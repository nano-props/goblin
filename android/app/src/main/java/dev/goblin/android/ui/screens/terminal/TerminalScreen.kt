package dev.goblin.android.ui.screens.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.terminal.TerminalController
import dev.goblin.android.terminal.TerminalSessionFactory
import dev.goblin.android.terminal.TerminalSessionState
import dev.goblin.android.ui.theme.GoblinColors
import dev.goblin.android.ui.theme.GoblinSpacing
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    host: SshHostProfile,
    terminalService: TerminalSessionFactory,
    onBack: () -> Unit,
) {
    var terminalState: TerminalSessionState by remember { mutableStateOf(TerminalSessionState.Idle) }
    var input by remember { mutableStateOf("") }
    val controller = remember(terminalService) {
        TerminalController(terminalService = terminalService) { terminalState = it }
    }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val target = remember(host) { RemoteTarget.fromHostProfile(host) }

    DisposableEffect(controller) {
        onDispose { controller.close() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Terminal spike") },
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
            LaunchedEffect(cols, rows) {
                controller.resize(cols, rows)
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(GoblinColors.TerminalBackground)
                    .padding(GoblinSpacing.Md),
                verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                TerminalStatusStrip(host = host, state = terminalState)
                TerminalViewport(state = terminalState)
                HelperKeyRow(
                    onEsc = { controller.sendInput("\u001b") },
                    onCtrl = { controller.sendInput("\u0003") },
                    onTab = { controller.sendInput("\t") },
                    onArrow = { code -> controller.sendInput(code) },
                    onPaste = {
                        scope.launch {
                            val text = clipboard.getClipEntry()
                                ?.clipData
                                ?.getItemAt(0)
                                ?.coerceToText(context)
                                ?.toString()
                                .orEmpty()
                            controller.paste(text)
                        }
                    },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                    BasicTextField(
                        modifier = Modifier
                            .weight(1f)
                            .background(MaterialTheme.colorScheme.surface)
                            .padding(GoblinSpacing.Sm),
                        value = input,
                        onValueChange = { input = it },
                        textStyle = TextStyle(
                            color = MaterialTheme.colorScheme.onSurface,
                            fontFamily = FontFamily.Monospace,
                        ),
                    )
                    Button(
                        onClick = {
                            controller.sendInput(input + "\n")
                            input = ""
                        },
                    ) {
                        Text("Send")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm)) {
                    Button(onClick = { controller.open(target) }) {
                        Text("Connect")
                    }
                    TextButton(onClick = { controller.close() }) {
                        Text("Close")
                    }
                }
            }
        }
    }
}

@Composable
private fun TerminalStatusStrip(host: SshHostProfile, state: TerminalSessionState) {
    val status = when (state) {
        TerminalSessionState.Idle -> "idle"
        TerminalSessionState.Connecting -> "connecting"
        is TerminalSessionState.Connected -> "connected"
        is TerminalSessionState.Resizing -> "resizing"
        is TerminalSessionState.Exited -> "exited"
        is TerminalSessionState.Failed -> "failed"
    }
    Text(
        text = "${host.title} - $status",
        color = GoblinColors.TerminalForeground,
        style = MaterialTheme.typography.labelMedium,
    )
}

@Composable
private fun TerminalViewport(state: TerminalSessionState) {
    val output = when (state) {
        is TerminalSessionState.Connected -> state.output
        is TerminalSessionState.Failed -> "Terminal disconnected. Reconnect or return to diagnostics.\n${state.message}"
        is TerminalSessionState.Exited -> "Terminal disconnected. Reconnect or return to diagnostics."
        TerminalSessionState.Connecting -> "Connecting..."
        is TerminalSessionState.Resizing -> "Resizing..."
        TerminalSessionState.Idle -> ""
    }
    Text(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 240.dp)
            .background(GoblinColors.TerminalBackground)
            .verticalScroll(rememberScrollState())
            .horizontalScroll(rememberScrollState()),
        text = output,
        color = GoblinColors.TerminalForeground,
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun HelperKeyRow(
    onEsc: () -> Unit,
    onCtrl: () -> Unit,
    onTab: () -> Unit,
    onArrow: (String) -> Unit,
    onPaste: () -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Xs),
    ) {
        TextButton(onClick = onEsc) { Text("Esc") }
        TextButton(onClick = onCtrl) { Text("Ctrl") }
        TextButton(onClick = onTab) { Text("Tab") }
        TextButton(onClick = { onArrow("\u001b[A") }) { Text("Up") }
        TextButton(onClick = { onArrow("\u001b[B") }) { Text("Down") }
        TextButton(onClick = { onArrow("\u001b[D") }) { Text("Left") }
        TextButton(onClick = { onArrow("\u001b[C") }) { Text("Right") }
        TextButton(onClick = onPaste) { Text("Paste") }
    }
}
