package dev.goblin.android.ui.screens.addhost

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import dev.goblin.android.domain.ssh.SshIdentityRef
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.ui.theme.GoblinSpacing

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddHostScreen(
    initialHost: SshHostProfile? = null,
    onBack: () -> Unit,
    onImportPrivateKey: (displayName: String, bytes: ByteArray) -> SshIdentityRef,
    onSaveHost: (SshHostProfile) -> Unit,
) {
    val context = LocalContext.current
    var alias by remember(initialHost) { mutableStateOf(initialHost?.alias.orEmpty()) }
    var host by remember(initialHost) { mutableStateOf(initialHost?.host.orEmpty()) }
    var user by remember(initialHost) { mutableStateOf(initialHost?.user.orEmpty()) }
    var port by remember(initialHost) { mutableStateOf(initialHost?.port?.toString() ?: "22") }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedIdentity by remember { mutableStateOf<SshIdentityRef?>(null) }
    val importPrivateKey = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalArgumentException("Unable to read selected identity")
            val displayName = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "SSH identity"
            onImportPrivateKey(displayName, bytes)
        }.onSuccess {
            selectedIdentity = it
            error = null
        }.onFailure {
            error = it.message ?: "Identity import failed"
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (initialHost == null) "Add host" else "Edit host") },
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
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = alias,
                onValueChange = { alias = it },
                label = { Text("Alias") },
                singleLine = true,
            )
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = host,
                onValueChange = { host = it },
                label = { Text("Host") },
                singleLine = true,
                isError = error != null && host.isBlank(),
            )
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = user,
                onValueChange = { user = it },
                label = { Text("User") },
                singleLine = true,
                isError = error != null && user.isBlank(),
            )
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = port,
                onValueChange = { port = it },
                label = { Text("Port") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            OutlinedButton(onClick = { importPrivateKey.launch(arrayOf("*/*")) }) {
                Text("Import private key")
            }
            selectedIdentity?.let {
                Text("Identity selected: ${it.displayName}", style = MaterialTheme.typography.labelMedium)
            }
            if (selectedIdentity == null && initialHost?.identityRefId != null) {
                Text("Existing identity selected", style = MaterialTheme.typography.labelMedium)
            }
            if (error != null) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(GoblinSpacing.Sm),
            ) {
                TextButton(onClick = onBack) {
                    Text("Cancel")
                }
                Button(
                    onClick = {
                        runCatching {
                            val parsedPort = SshHostProfile.parsePort(port)
                            val identityRefId = selectedIdentity?.id ?: initialHost?.identityRefId
                            if (initialHost == null) {
                                SshHostProfile.create(
                                    alias = alias,
                                    host = host,
                                    user = user,
                                    port = parsedPort,
                                    identityRefId = identityRefId,
                                )
                            } else {
                                SshHostProfile.update(
                                    existing = initialHost,
                                    alias = alias,
                                    host = host,
                                    user = user,
                                    port = parsedPort,
                                    identityRefId = identityRefId,
                                )
                            }
                        }.onSuccess {
                            error = null
                            onSaveHost(it)
                        }.onFailure {
                            error = it.message ?: "Validation error"
                        }
                    },
                ) {
                    Text(if (initialHost == null) "Save host" else "Save changes")
                }
            }
        }
    }
}
