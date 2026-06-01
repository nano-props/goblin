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
    fun `resize before open uses requested size for shell startup`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        assertFalse(controller.resize(120, 40))
        controller.open(target())

        assertEquals(120, service.openCols)
        assertEquals(40, service.openRows)
    }

    @Test
    fun `close cleans up active shell session`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        controller.close()
        controller.close()

        assertTrue(service.session.closed)
        assertTrue(controller.state is TerminalSessionState.Exited)
    }

    @Test
    fun `opening a new shell closes the previous session`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        val firstSession = service.session
        controller.open(target())

        assertTrue(firstSession.closed)
        assertFalse(service.session.closed)
    }

    @Test
    fun `sendInput returns false without active session`() {
        val controller = TerminalController(FakeTerminalSessionFactory())

        assertFalse(controller.sendInput("ls\n"))
    }

    @Test
    fun `sendInput failure moves terminal to failed instead of throwing`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)
        service.sessionInputError = IllegalStateException("network on main")

        controller.open(target())

        assertFalse(controller.sendInput("ls\n"))
        assertTrue(controller.state is TerminalSessionState.Failed)
    }

    @Test
    fun `high volume output is capped for phone rendering`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        service.emitOutput("x".repeat(100_000))

        val state = controller.state as TerminalSessionState.Connected
        assertEquals(32_000, state.output.length)
    }

    @Test
    fun `terminal output filters control sequences before display`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        service.emitOutput("\u001B[?2004h$ echo ok\n\u001B[?2004l")

        val state = controller.state as TerminalSessionState.Connected
        assertEquals("ready\n$ echo ok\n", state.output)
    }

    @Test
    fun `terminal output filters split control sequences before display`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())
        service.emitOutput("\u001B[?20")
        service.emitOutput("04hprompt")

        val state = controller.state as TerminalSessionState.Connected
        assertEquals("ready\nprompt", state.output)
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
        var openCols: Int = 0
        var openRows: Int = 0
        var sessionInputError: RuntimeException? = null
        private lateinit var onOutput: (String) -> Unit

        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (String) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession {
            openCols = cols
            openRows = rows
            this.onOutput = onOutput
            session = FakeTerminalSession(sessionInputError)
            onOutput("ready\n")
            return session
        }

        fun emitOutput(value: String) {
            onOutput(value)
        }
    }

    private class FakeTerminalSession(
        private val inputError: RuntimeException? = null,
    ) : TerminalSession {
        override val id: String = "session-1"
        val sentInput = mutableListOf<String>()
        val resizes = mutableListOf<Pair<Int, Int>>()
        var closed = false

        override fun sendInput(value: String) {
            inputError?.let { throw it }
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
