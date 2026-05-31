package dev.goblin.android.ui.screens.placeholders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.goblin.android.ui.theme.GoblinSpacing

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsPlaceholderScreen(
    hostId: String,
    onBack: () -> Unit,
    onOpenTerminal: () -> Unit,
) {
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
            Text("Host $hostId")
            Button(onClick = onOpenTerminal) {
                Text("Open terminal")
            }
            Text("Run diagnostics")
            Text("SSH")
            Text("Shell")
            Text("Git")
            Text("Path")
            Text("Repo")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalPlaceholderScreen(hostId: String, onBack: () -> Unit) {
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(GoblinSpacing.Md),
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Md),
        ) {
            Text("Host $hostId")
            Text("Terminal disconnected. Reconnect or return to diagnostics.")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsPlaceholderScreen(onBack: () -> Unit) {
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
            verticalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
        ) {
            Text("Goblin Android")
            Text("SSH remote-first emergency operations.")
        }
    }
}

