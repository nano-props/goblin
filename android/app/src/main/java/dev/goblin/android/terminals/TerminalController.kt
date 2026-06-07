package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets

class TerminalController(
    private val terminalService: TerminalSessionFactory,
    initialOutput: String = "",
    private val onRawOutput: (ByteArray) -> Unit = {},
    private val onStateChanged: (TerminalSessionState) -> Unit = {},
) {
    var state: TerminalSessionState = TerminalSessionState.Idle
        private set

    private var session: TerminalSession? = null
    private val initialOutputSnapshot: String = terminalOutputSnapshot(initialOutput)
    private var output: String = initialOutputSnapshot
    private val outputFilter = TerminalOutputFilter()
    private var cols: Int = TerminalSessionDefaults.Cols
    private var rows: Int = TerminalSessionDefaults.Rows
    private var activeRemotePath: String? = null
    private var earlyCloseDuringOpen: EarlyTerminalClose? = null

    fun isConnected(): Boolean = runCatching {
        session?.isConnected() == true
    }.getOrDefault(false)

    fun disconnectForHeartbeat(reason: TerminalDisconnectedReason = TerminalDisconnectedReason.SshDisconnected) {
        val current = session ?: return
        runCatching { current.close() }
        fail(
            IllegalStateException("Terminal heartbeat failed: $reason"),
            reason,
        )
    }

    fun open(target: RemoteTarget, secrets: SshConnectionSecrets = SshConnectionSecrets()) {
        session?.close()
        session = null
        activeRemotePath = target.remotePath
        earlyCloseDuringOpen = null
        output = initialOutputSnapshot
        outputFilter.reset()
        update(TerminalSessionState.Connecting)
        runCatching {
            terminalService.openShell(
                target = target,
                secrets = secrets,
                cols = cols,
                rows = rows,
                onOutput = ::appendOutput,
                onExit = { closeFromRemote() },
                onFailure = { fail(it, TerminalDisconnectedReason.SshDisconnected) },
            )
        }.onSuccess {
            val earlyClose = earlyCloseDuringOpen
            earlyCloseDuringOpen = null
            if (earlyClose != null) {
                runCatching { it.close() }
                session = null
                activeRemotePath = null
                update(earlyClose.toState(it.id, output))
            } else {
                session = it
                update(TerminalSessionState.Connected(it.id, output, cols, rows))
            }
        }.onFailure {
            earlyCloseDuringOpen = null
            activeRemotePath = null
            update(
                TerminalSessionState.Failed(
                    message = TerminalDisconnectDiagnostics.startupFailureMessage(it),
                    cause = it,
                    reason = TerminalDisconnectedReason.TerminalFailure,
                    output = output,
                ),
            )
        }
    }

    fun sendInput(value: String): Boolean =
        sendInputBytes(value.toByteArray(Charsets.UTF_8))

    fun sendInputBytes(value: ByteArray): Boolean {
        val current = session ?: return false
        if (value.isEmpty()) return false
        return runCatching {
            current.sendInputBytes(value)
        }.fold(
            onSuccess = { true },
            onFailure = {
                fail(it, TerminalDisconnectedReason.SshDisconnected)
                false
            },
        )
    }

    fun paste(value: String): Boolean = sendInput(value)

    fun resize(nextCols: Int, nextRows: Int): Boolean {
        val safeCols = nextCols.coerceIn(MinCols, MaxCols)
        val safeRows = nextRows.coerceIn(MinRows, MaxRows)
        cols = safeCols
        rows = safeRows
        val current = session ?: return false
        update(TerminalSessionState.Resizing(current.id, safeCols, safeRows))
        return runCatching {
            current.resize(safeCols, safeRows)
        }.fold(
            onSuccess = {
                update(TerminalSessionState.Connected(current.id, output, safeCols, safeRows))
                true
            },
            onFailure = {
                fail(it, TerminalDisconnectedReason.SshDisconnected)
                false
            },
        )
    }

    fun close() {
        val current = session ?: return
        session = null
        activeRemotePath = null
        runCatching { current.close() }
        update(TerminalSessionState.Exited(current.id, reason = TerminalDisconnectedReason.UserClosed, output = output))
    }

    private fun appendOutput(value: ByteArray) {
        val rawFrame = value.copyOf()
        onRawOutput(rawFrame)
        val visibleOutput = outputFilter.append(rawFrame.toString(Charsets.UTF_8))
        if (visibleOutput.isEmpty()) return
        output = (output + visibleOutput).takeLast(MaxOutputChars)
        val current = session
        if (current != null) update(TerminalSessionState.Connected(current.id, output, cols, rows))
    }

    private fun closeFromRemote() {
        val message = TerminalDisconnectDiagnostics.remoteExitMessage(
            output = output,
            remotePath = activeRemotePath,
        )
        val current = session
        if (current == null) {
            if (state == TerminalSessionState.Connecting) {
                earlyCloseDuringOpen = EarlyTerminalClose.Exited(message)
            }
            return
        }
        session = null
        activeRemotePath = null
        update(
            TerminalSessionState.Exited(
                current.id,
                exitMessage = message,
                reason = TerminalDisconnectedReason.RemoteExited,
                output = output,
            ),
        )
    }

    private fun fail(error: Throwable, reason: TerminalDisconnectedReason) {
        val current = session
        val message = TerminalDisconnectDiagnostics.failureMessage(
            error = error,
            reason = reason,
            output = output,
            remotePath = activeRemotePath,
        )
        if (current == null) {
            if (state == TerminalSessionState.Connecting) {
                earlyCloseDuringOpen = EarlyTerminalClose.Failed(
                    message = message,
                    cause = error,
                    reason = reason,
                )
            }
            return
        }
        session = null
        activeRemotePath = null
        update(
            TerminalSessionState.Failed(
                message = message,
                cause = error,
                reason = reason,
                sessionId = current.id,
                output = output,
            ),
        )
    }

    private fun update(next: TerminalSessionState) {
        state = next
        onStateChanged(next)
    }

    private sealed interface EarlyTerminalClose {
        fun toState(sessionId: String, output: String): TerminalSessionState

        data class Exited(val message: String) : EarlyTerminalClose {
            override fun toState(sessionId: String, output: String): TerminalSessionState =
                TerminalSessionState.Exited(
                    sessionId = sessionId,
                    exitMessage = message,
                    reason = TerminalDisconnectedReason.RemoteExited,
                    output = output,
                )
        }

        data class Failed(
            val message: String,
            val cause: Throwable,
            val reason: TerminalDisconnectedReason,
        ) : EarlyTerminalClose {
            override fun toState(sessionId: String, output: String): TerminalSessionState =
                TerminalSessionState.Failed(
                    message = message,
                    cause = cause,
                    reason = reason,
                    sessionId = sessionId,
                    output = output,
                )
        }
    }

    companion object {
        private const val MinCols = 20
        private const val MaxCols = 240
        private const val MinRows = 6
        private const val MaxRows = 100
        private const val MaxOutputChars = 32_000
    }
}

internal object TerminalDisconnectDiagnostics {
    fun startupFailureMessage(error: Throwable): String =
        error.toTerminalDetail()

    fun remoteExitMessage(output: String, remotePath: String?): String =
        startupContextMessage(
            prefix = "SSH shell closed",
            detail = null,
            output = output,
            remotePath = remotePath,
        )

    fun failureMessage(
        error: Throwable,
        reason: TerminalDisconnectedReason,
        output: String,
        remotePath: String?,
    ): String {
        val detail = error.toTerminalDetail()
        if (reason != TerminalDisconnectedReason.SshDisconnected) return detail
        return startupContextMessage(
            prefix = "SSH disconnected",
            detail = detail,
            output = output,
            remotePath = remotePath,
        )
    }

    private fun startupContextMessage(
        prefix: String,
        detail: String?,
        output: String,
        remotePath: String?,
    ): String {
        val path = remotePath?.trim()?.takeIf { it.isNotBlank() }
        val base = buildString {
            append(prefix)
            append(" after startup")
            if (path != null) {
                append(" for ")
                append(path)
            }
        }
        val lastOutput = lastOutputForMessage(output)
        return buildString {
            append(base)
            if (detail != null) {
                append(": ")
                append(detail)
            } else {
                append(".")
            }
            if (lastOutput != null) {
                append(" Last output: ")
                append(lastOutput)
            }
        }
    }

    private fun lastOutputForMessage(output: String): String? =
        output
            .replace("\r\n", "\n")
            .replace('\r', '\n')
            .trim()
            .takeIf { it.isNotBlank() }
            ?.takeLast(MaxLastOutputMessageChars)

    private const val MaxLastOutputMessageChars = 500

    private fun Throwable.toTerminalDetail(): String {
        val message = message?.trim()?.takeIf { it.isNotBlank() }
        val className = this::class.java.simpleName.takeIf { it.isNotBlank() }
            ?: this::class.java.name
        return message ?: className
    }
}

interface TerminalSessionFactory {
    fun openShell(
        target: RemoteTarget,
        secrets: SshConnectionSecrets,
        cols: Int,
        rows: Int,
        onOutput: (ByteArray) -> Unit,
        onExit: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ): TerminalSession
}

interface TerminalSession {
    val id: String
    fun isConnected(): Boolean
    fun sendInputBytes(value: ByteArray)
    fun sendInput(value: String) {
        sendInputBytes(value.toByteArray(Charsets.UTF_8))
    }
    fun resize(cols: Int, rows: Int)
    fun close()
}
