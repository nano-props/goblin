package dev.goblin.android.terminal

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalControllerTest {
    @Test
    fun `sendInput writes to active shell session`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())

        assertTrue(controller.sendInput("ls\n"))
        assertEquals(listOf("ls\n"), service.session.sentInput)
    }

    @Test
    fun `paste routing writes clipboard text to shell stream`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())

        assertTrue(controller.paste("echo ok"))
        assertEquals(listOf("echo ok"), service.session.sentInput)
    }

    @Test
    fun `resize calls active shell resize path`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())

        assertTrue(controller.resize(100, 30))
        assertEquals(listOf(100 to 30), service.session.resizes)
        assertTrue(controller.state is TerminalSessionState.Connected)
    }

    @Test
    fun `close cleans up active shell session`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        controller.close()

        assertTrue(service.session.closed)
        assertTrue(controller.state is TerminalSessionState.Exited)
    }

    @Test
    fun `sendInput returns false without active session`() {
        val controller = TerminalController(FakeTerminalSessionFactory())

        assertFalse(controller.sendInput("ls\n"))
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

    private class FakeTerminalSessionFactory : TerminalSessionFactory {
        lateinit var session: FakeTerminalSession

        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (String) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession {
            session = FakeTerminalSession()
            onOutput("ready\n")
            return session
        }
    }

    private class FakeTerminalSession : TerminalSession {
        override val id: String = "session-1"
        val sentInput = mutableListOf<String>()
        val resizes = mutableListOf<Pair<Int, Int>>()
        var closed = false

        override fun sendInput(value: String) {
            sentInput.add(value)
        }

        override fun resize(cols: Int, rows: Int) {
            resizes.add(cols to rows)
        }

        override fun close() {
            closed = true
        }
    }
}

