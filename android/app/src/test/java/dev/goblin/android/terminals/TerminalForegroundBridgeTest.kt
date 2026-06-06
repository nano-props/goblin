package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalForegroundBridgeTest {
    @Test
    fun `zero running sessions stops foreground ownership`() {
        val owner = RecordingForegroundOwner()
        val bridge = TerminalForegroundBridge(
            sessionProvider = { emptyList() },
            owner = owner,
        )

        bridge.sync()

        assertEquals(1, owner.stopCount)
        assertTrue(owner.startedContent.isEmpty())
    }

    @Test
    fun `running sessions start or update foreground ownership`() {
        val owner = RecordingForegroundOwner()
        val bridge = TerminalForegroundBridge(
            sessionProvider = {
                listOf(
                    TerminalSessionRecord(
                        id = "terminal-1",
                        hostId = "host-1",
                        repositoryId = null,
                        remotePath = "/",
                        targetLabel = "Dev - /",
                        status = TerminalSessionStatus.Running,
                        openedAt = 100L,
                        lastActivityAt = 200L,
                    ),
                )
            },
            owner = owner,
        )

        bridge.sync()

        assertEquals(0, owner.stopCount)
        assertEquals("terminal-1", owner.startedContent.single().terminalSessionId)
    }

    @Test
    fun `manager owned running sessions update foreground ownership`() {
        val owner = RecordingForegroundOwner()
        val manager = TerminalSessionManager(
            terminalService = FakeTerminalSessionFactory(),
            clock = { 100L },
            idGenerator = { "terminal-1" },
        )
        val bridge = TerminalForegroundBridge(manager = manager, owner = owner)

        manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")
        bridge.sync()

        assertEquals("terminal-1", owner.startedContent.single().terminalSessionId)
    }

    private class RecordingForegroundOwner : TerminalForegroundOwner {
        val startedContent = mutableListOf<TerminalNotificationContent>()
        var stopCount = 0

        override fun startOrUpdate(content: TerminalNotificationContent) {
            startedContent.add(content)
        }

        override fun stop() {
            stopCount += 1
        }
    }

    private class FakeTerminalSessionFactory : TerminalSessionFactory {
        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (String) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession = object : TerminalSession {
            override val id: String = "backend-session-1"
            override fun isConnected(): Boolean = true
            override fun sendInput(value: String) = Unit
            override fun resize(cols: Int, rows: Int) = Unit
            override fun close() = Unit
        }
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
}
