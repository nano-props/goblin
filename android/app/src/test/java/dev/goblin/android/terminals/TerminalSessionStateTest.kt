package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalSessionStateTest {
    @Test
    fun `terminal record output snapshot keeps only recent content`() {
        val snapshot = terminalOutputSnapshot("a".repeat(40_000))

        assertEquals(TerminalSessionRecord.MaxOutputSnapshotChars, snapshot.length)
    }

    @Test
    fun `terminal record with remote exit maps to exited state with reason`() {
        val record = terminalRecord(
            status = TerminalSessionStatus.Exited,
            disconnectedReason = TerminalDisconnectedReason.RemoteExited,
        )

        val state = record.toTerminalSessionState()

        assertTrue(state is TerminalSessionState.Exited)
        assertEquals(TerminalDisconnectedReason.RemoteExited, (state as TerminalSessionState.Exited).reason)
    }

    @Test
    fun `terminal record with stopped Android service maps to disconnected state with reason`() {
        val record = terminalRecord(
            status = TerminalSessionStatus.Disconnected,
            disconnectedReason = TerminalDisconnectedReason.AndroidServiceStopped,
            disconnectedMessage = "service process stopped",
        )

        val state = record.toTerminalSessionState()

        assertTrue(state is TerminalSessionState.Disconnected)
        assertEquals(
            TerminalDisconnectedReason.AndroidServiceStopped,
            (state as TerminalSessionState.Disconnected).reason,
        )
        assertEquals("service process stopped", state.message)
    }

    @Test
    fun `terminal transitions connected to exited`() {
        val service = ControlledTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        controller.close()

        assertTrue(controller.state is TerminalSessionState.Exited)
    }

    @Test
    fun `terminal transitions connected to failed`() {
        val service = ControlledTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        service.fail(IllegalStateException("lost connection"))

        assertTrue(controller.state is TerminalSessionState.Failed)
    }

    private fun target(): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = "/",
        identityRefId = null,
    )

    private fun terminalRecord(
        status: TerminalSessionStatus,
        disconnectedReason: TerminalDisconnectedReason?,
        disconnectedMessage: String? = null,
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = "terminal-1",
        hostId = "lee@example.com:22/",
        repositoryId = "repo-1",
        remotePath = "/srv/app",
        targetLabel = "App - /srv/app",
        status = status,
        lastOutputSnapshot = "recent output",
        lastActivityAt = 200L,
        openedAt = 100L,
        foregroundServiceOwned = false,
        disconnectedReason = disconnectedReason,
        disconnectedMessage = disconnectedMessage,
    )

    private class ControlledTerminalSessionFactory : TerminalSessionFactory {
        private lateinit var onFailure: (Throwable) -> Unit

        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (ByteArray) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession {
            this.onFailure = onFailure
            return object : TerminalSession {
                override val id: String = "session-1"
                override fun isConnected(): Boolean = true
                override fun sendInputBytes(value: ByteArray) = Unit
                override fun resize(cols: Int, rows: Int) = Unit
                override fun close() = Unit
            }
        }

        fun fail(error: Throwable) {
            onFailure(error)
        }
    }
}
