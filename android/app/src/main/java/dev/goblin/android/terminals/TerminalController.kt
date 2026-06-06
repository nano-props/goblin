package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets

class TerminalController(
    private val terminalService: TerminalSessionFactory,
    private val onStateChanged: (TerminalSessionState) -> Unit = {},
) {
    var state: TerminalSessionState = TerminalSessionState.Idle
        private set

    private var session: TerminalSession? = null
    private var output: String = ""
    private val outputFilter = TerminalOutputFilter()
    private var cols: Int = TerminalSessionDefaults.Cols
    private var rows: Int = TerminalSessionDefaults.Rows

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
        output = ""
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
            session = it
            update(TerminalSessionState.Connected(it.id, output, cols, rows))
        }.onFailure {
            update(
                TerminalSessionState.Failed(
                    message = it.message ?: "Terminal failed",
                    cause = it,
                    reason = TerminalDisconnectedReason.TerminalFailure,
                ),
            )
        }
    }

    fun sendInput(value: String): Boolean {
        val current = session ?: return false
        if (value.isEmpty()) return false
        return runCatching {
            current.sendInput(value)
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
        runCatching { current.close() }
        update(TerminalSessionState.Exited(current.id, reason = TerminalDisconnectedReason.UserClosed, output = output))
    }

    private fun appendOutput(value: String) {
        val visibleOutput = outputFilter.append(value)
        if (visibleOutput.isEmpty()) return
        output = (output + visibleOutput).takeLast(MaxOutputChars)
        val current = session
        if (current != null) update(TerminalSessionState.Connected(current.id, output, cols, rows))
    }

    private fun closeFromRemote() {
        val current = session ?: return
        session = null
        update(TerminalSessionState.Exited(current.id, reason = TerminalDisconnectedReason.RemoteExited, output = output))
    }

    private fun fail(error: Throwable, reason: TerminalDisconnectedReason) {
        val current = session
        session = null
        update(
            TerminalSessionState.Failed(
                message = error.message ?: "Terminal failed",
                cause = error,
                reason = reason,
                sessionId = current?.id,
                output = output,
            ),
        )
    }

    private fun update(next: TerminalSessionState) {
        state = next
        onStateChanged(next)
    }

    companion object {
        private const val MinCols = 20
        private const val MaxCols = 240
        private const val MinRows = 6
        private const val MaxRows = 100
        private const val MaxOutputChars = 32_000
    }
}

interface TerminalSessionFactory {
    fun openShell(
        target: RemoteTarget,
        secrets: SshConnectionSecrets,
        cols: Int,
        rows: Int,
        onOutput: (String) -> Unit,
        onExit: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ): TerminalSession
}

interface TerminalSession {
    val id: String
    fun isConnected(): Boolean
    fun sendInput(value: String)
    fun resize(cols: Int, rows: Int)
    fun close()
}
