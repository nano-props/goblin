package dev.goblin.android.terminals

data class TerminalSessionRecord(
    val id: String,
    val hostId: String,
    val repositoryId: String?,
    val remotePath: String,
    val targetLabel: String,
    val displayName: String = "",
    val status: TerminalSessionStatus,
    val lastOutputSnapshot: String = "",
    val lastActivityAt: Long? = null,
    val openedAt: Long,
    val foregroundServiceOwned: Boolean = false,
    val disconnectedReason: TerminalDisconnectedReason? = null,
    val disconnectedMessage: String? = null,
) {
    init {
        require(id.isNotBlank()) { "Terminal session id is required" }
        require(hostId.isNotBlank()) { "Terminal host id is required" }
        require(remotePath.isNotBlank()) { "Terminal remote path is required" }
        require(targetLabel.isNotBlank()) { "Terminal target label is required" }
        require(lastOutputSnapshot.length <= MaxOutputSnapshotChars) {
            "Terminal output snapshot must be bounded"
        }
        require((disconnectedMessage?.length ?: 0) <= MaxDisconnectedMessageChars) {
            "Terminal disconnect message must be bounded"
        }
    }

    companion object {
        const val MaxOutputSnapshotChars = 32_000
        const val MaxDisconnectedMessageChars = 1_000
    }
}

enum class TerminalSessionStatus {
    Starting,
    Running,
    Exited,
    Failed,
    Disconnected,
}

enum class TerminalDisconnectedReason {
    UserClosed,
    RemoteExited,
    SshDisconnected,
    AndroidServiceStopped,
    TerminalWriteTimeout,
    TerminalFailure,
}

fun terminalOutputSnapshot(value: String): String =
    value.takeLast(TerminalSessionRecord.MaxOutputSnapshotChars)

fun terminalDisconnectedMessageSnapshot(value: String?): String? =
    value
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?.take(TerminalSessionRecord.MaxDisconnectedMessageChars)

fun TerminalSessionRecord.toTerminalSessionState(): TerminalSessionState = when (status) {
    TerminalSessionStatus.Starting -> TerminalSessionState.Connecting
    TerminalSessionStatus.Running -> TerminalSessionState.Connected(
        sessionId = id,
        output = lastOutputSnapshot,
        cols = TerminalSessionDefaults.Cols,
        rows = TerminalSessionDefaults.Rows,
    )
    TerminalSessionStatus.Exited -> TerminalSessionState.Exited(
        sessionId = id,
        reason = disconnectedReason ?: TerminalDisconnectedReason.RemoteExited,
        output = lastOutputSnapshot,
    )
    TerminalSessionStatus.Failed -> TerminalSessionState.Failed(
        message = disconnectedMessage ?: "Terminal failed",
        reason = disconnectedReason ?: TerminalDisconnectedReason.TerminalFailure,
        sessionId = id,
        output = lastOutputSnapshot,
    )
    TerminalSessionStatus.Disconnected -> TerminalSessionState.Disconnected(
        sessionId = id,
        reason = disconnectedReason ?: TerminalDisconnectedReason.SshDisconnected,
        message = disconnectedMessage ?: "disconnected",
        output = lastOutputSnapshot,
    )
}

internal object TerminalSessionDefaults {
    const val Cols = 80
    const val Rows = 24
}
