package dev.goblin.android.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import dev.goblin.android.terminals.MaxTerminalHeartbeatIntervalSeconds
import dev.goblin.android.terminals.MaxTerminalHeartbeatFailureThreshold
import dev.goblin.android.terminals.MinTerminalHeartbeatIntervalSeconds
import dev.goblin.android.terminals.MinTerminalHeartbeatFailureThreshold
import dev.goblin.android.ui.theme.GoblinSpacing

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    initialKeepAliveIntervalSeconds: Long,
    initialHeartbeatFailureThreshold: Int,
    onBack: () -> Unit,
    onSave: (Long, Int) -> Unit,
) {
    var keepAliveText by remember(initialKeepAliveIntervalSeconds) {
        mutableStateOf(initialKeepAliveIntervalSeconds.toString())
    }
    var heartbeatFailureThresholdText by remember(initialHeartbeatFailureThreshold) {
        mutableStateOf(initialHeartbeatFailureThreshold.toString())
    }
    val parsedKeepAlive = keepAliveText.toLongOrNull()
    val parsedHeartbeatFailureThreshold = heartbeatFailureThresholdText.toIntOrNull()

    val keepAliveError = when {
        keepAliveText.isBlank() -> "Enter a value."
        parsedKeepAlive == null -> "Only numbers are allowed."
        parsedKeepAlive !in MinTerminalHeartbeatIntervalSeconds..MaxTerminalHeartbeatIntervalSeconds -> {
            "Interval must be between ${MinTerminalHeartbeatIntervalSeconds} and ${MaxTerminalHeartbeatIntervalSeconds} seconds."
        }
        else -> null
    }

    val heartbeatFailureThresholdError = when {
        heartbeatFailureThresholdText.isBlank() -> "Enter a value."
        parsedHeartbeatFailureThreshold == null -> "Only numbers are allowed."
        parsedHeartbeatFailureThreshold !in MinTerminalHeartbeatFailureThreshold..MaxTerminalHeartbeatFailureThreshold -> {
            "Failure threshold must be between ${MinTerminalHeartbeatFailureThreshold} and ${MaxTerminalHeartbeatFailureThreshold}."
        }
        else -> null
    }

    val canSave = parsedKeepAlive != null &&
        parsedHeartbeatFailureThreshold != null &&
        keepAliveError == null &&
        heartbeatFailureThresholdError == null &&
        (parsedKeepAlive != initialKeepAliveIntervalSeconds || parsedHeartbeatFailureThreshold != initialHeartbeatFailureThreshold)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
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
            Text("SSH terminal keepalive interval")
            OutlinedTextField(
                value = keepAliveText,
                onValueChange = { keepAliveText = it.filter(Char::isDigit).take(6) },
                label = { Text("Interval (seconds)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = keepAliveError != null,
                supportingText = {
                    if (keepAliveError != null) {
                        Text(keepAliveError)
                    } else {
                        Text("Range: ${MinTerminalHeartbeatIntervalSeconds}-${MaxTerminalHeartbeatIntervalSeconds} seconds.")
                    }
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Heartbeat failure threshold")
            OutlinedTextField(
                value = heartbeatFailureThresholdText,
                onValueChange = { heartbeatFailureThresholdText = it.filter(Char::isDigit).take(3) },
                label = { Text("Failed checks before close") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = heartbeatFailureThresholdError != null,
                supportingText = {
                    if (heartbeatFailureThresholdError != null) {
                        Text(heartbeatFailureThresholdError)
                    } else {
                        Text("Range: ${MinTerminalHeartbeatFailureThreshold}-${MaxTerminalHeartbeatFailureThreshold}.")
                    }
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    val keepAlive = parsedKeepAlive ?: return@Button
                    val heartbeatFailureThreshold = parsedHeartbeatFailureThreshold ?: return@Button
                    onSave(keepAlive, heartbeatFailureThreshold)
                },
                enabled = canSave,
            ) {
                Text("Save")
            }
            Text("Current strategy: SSH keepalive @openssh.com")
        }
    }
}
