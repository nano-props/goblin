package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget

interface ExternalTermuxEnvironment {
    fun isTermuxInstalled(): Boolean
    fun canRunCommandDirectly(): Boolean
    fun launchRunCommand(command: String, stdin: String? = null): Boolean
    fun copyCommand(command: String): Boolean
    fun openTermux(): Boolean
}

sealed interface ExternalTermuxLaunchResult {
    data object Launched : ExternalTermuxLaunchResult
    data class CopiedFallback(val openedTermux: Boolean) : ExternalTermuxLaunchResult
    data class Unavailable(val copiedCommand: Boolean) : ExternalTermuxLaunchResult
    data class Failed(
        val copiedCommand: Boolean,
        val openedTermux: Boolean,
        val message: String,
    ) : ExternalTermuxLaunchResult
}

data class ExternalTermuxLaunchRequest(
    val target: RemoteTarget,
    val privateKeyBytes: ByteArray? = null,
) {
    init {
        require(privateKeyBytes == null || privateKeyBytes.isNotEmpty()) { "Private key data is required" }
    }
}

fun externalTermuxLaunchRequest(
    target: RemoteTarget,
    loadPrivateKeyById: (String) -> ByteArray,
): ExternalTermuxLaunchRequest =
    ExternalTermuxLaunchRequest(
        target = target,
        privateKeyBytes = target.identityRefId?.let(loadPrivateKeyById),
    )

class ExternalTermuxLauncher(
    private val environment: ExternalTermuxEnvironment,
) {
    fun openInTermux(target: RemoteTarget): ExternalTermuxLaunchResult =
        openInTermux(ExternalTermuxLaunchRequest(target = target))

    fun openInTermux(request: ExternalTermuxLaunchRequest): ExternalTermuxLaunchResult {
        val target = request.target
        val command = TermuxCommandBuilder.sshWorkspaceCommand(TermuxCommandBuilder.fromRemoteTarget(target))
        if (!environment.isTermuxInstalled()) {
            return ExternalTermuxLaunchResult.Unavailable(copiedCommand = environment.copyCommand(command))
        }

        if (environment.canRunCommandDirectly()) {
            val launched = request.privateKeyBytes?.let { privateKeyBytes ->
                val privateKeyCommand = TermuxCommandBuilder.sshWorkspaceCommandWithStdinPrivateKey(
                    TermuxCommandBuilder.fromRemoteTarget(target),
                )
                environment.launchRunCommand(
                    command = privateKeyCommand,
                    stdin = privateKeyBytes.toString(Charsets.UTF_8),
                )
            } ?: environment.launchRunCommand(command)

            if (launched) {
                return ExternalTermuxLaunchResult.Launched
            }
        }

        val copied = environment.copyCommand(command)
        val opened = environment.openTermux()
        if (copied || opened) {
            return ExternalTermuxLaunchResult.CopiedFallback(openedTermux = opened)
        }

        return ExternalTermuxLaunchResult.Failed(
            copiedCommand = false,
            openedTermux = false,
            message = "Termux command API unavailable",
        )
    }

    fun copyCommand(target: RemoteTarget): Boolean {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(TermuxCommandBuilder.fromRemoteTarget(target))
        return environment.copyCommand(command)
    }
}
