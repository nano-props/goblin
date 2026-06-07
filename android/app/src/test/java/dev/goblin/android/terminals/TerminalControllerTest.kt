package dev.goblin.android.terminals

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import java.io.IOException
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
    fun `raw output is emitted before plain text filtering`() {
        val service = FakeTerminalSessionFactory()
        val rawFrames = mutableListOf<String>()
        val controller = TerminalController(
            terminalService = service,
            onRawOutput = { bytes -> rawFrames += bytes.toString(Charsets.UTF_8) },
        )

        controller.open(target())
        service.emitOutput("\u001B[?2004hprompt")

        val state = controller.state as TerminalSessionState.Connected
        assertEquals(listOf("ready\n", "\u001B[?2004hprompt"), rawFrames)
        assertEquals("ready\nprompt", state.output)
    }

    @Test
    fun `sendInputBytes writes raw bytes to active shell session`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target())

        assertTrue(controller.sendInputBytes(byteArrayOf(0x1B, 0x5B, 0x41)))
        assertEquals(listOf("\u001B[A"), service.session.sentInput)
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
    fun `open can preserve existing output for reconnect`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service, initialOutput = "before\n")

        controller.open(target())

        val state = controller.state as TerminalSessionState.Connected
        assertEquals("before\nready\n", state.output)
    }

    @Test
    fun `open failure preserves existing output for reconnect`() {
        val service = FakeTerminalSessionFactory()
        service.openError = IllegalStateException("connection refused")
        val controller = TerminalController(service, initialOutput = "before\n")

        controller.open(target())

        val state = controller.state as TerminalSessionState.Failed
        assertEquals("before\n", state.output)
    }

    @Test
    fun `remote EOF failure includes startup context and last output`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target(remotePath = "/srv/app"))
        service.emitOutput("cd '/srv/app' && pwd\r\n/srv/app\r\n")
        service.fail(IOException("broken transport, encountered EOF"))

        val state = controller.state as TerminalSessionState.Failed
        assertEquals(TerminalDisconnectedReason.SshDisconnected, state.reason)
        assertTrue(state.message.contains("SSH disconnected after startup for /srv/app"))
        assertTrue(state.message.contains("broken transport, encountered EOF"))
        assertTrue(state.message.contains("Last output:"))
        assertTrue(state.message.contains("/srv/app"))
    }

    @Test
    fun `remote failure with blank message includes exception class`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target(remotePath = "/srv/app"))
        service.fail(BlankMessageException())

        val state = controller.state as TerminalSessionState.Failed
        assertTrue(state.message.contains("SSH disconnected after startup for /srv/app"))
        assertTrue(state.message.contains("BlankMessageException"))
    }

    @Test
    fun `remote shell exit includes startup context and last output`() {
        val service = FakeTerminalSessionFactory()
        val controller = TerminalController(service)

        controller.open(target(remotePath = "/srv/app"))
        service.emitOutput("cd '/srv/app' && pwd\r\n/srv/app\r\n")
        service.exit()

        val state = controller.state as TerminalSessionState.Exited
        assertEquals(TerminalDisconnectedReason.RemoteExited, state.reason)
        assertTrue(state.exitMessage.contains("SSH shell closed after startup for /srv/app"))
        assertTrue(state.exitMessage.contains("Last output:"))
        assertTrue(state.exitMessage.contains("/srv/app"))
    }

    @Test
    fun `remote exit during shell startup is not overwritten by connected state`() {
        val service = FakeTerminalSessionFactory()
        service.exitBeforeReturn = true
        val controller = TerminalController(service)

        controller.open(target(remotePath = "/srv/app"))

        val state = controller.state as TerminalSessionState.Exited
        assertEquals("session-1", state.sessionId)
        assertTrue(state.exitMessage.contains("SSH shell closed after startup for /srv/app"))
        assertTrue(service.session.closed)
    }

    @Test
    fun `remote failure during shell startup is not overwritten by connected state`() {
        val service = FakeTerminalSessionFactory()
        service.failureBeforeReturn = IOException("broken transport, encountered EOF")
        val controller = TerminalController(service)

        controller.open(target(remotePath = "/srv/app"))

        val state = controller.state as TerminalSessionState.Failed
        assertEquals("session-1", state.sessionId)
        assertTrue(state.message.contains("SSH disconnected after startup for /srv/app"))
        assertTrue(state.message.contains("broken transport, encountered EOF"))
        assertTrue(service.session.closed)
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

    private fun target(remotePath: String = "/"): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = remotePath,
        identityRefId = null,
    )

    private class BlankMessageException : RuntimeException()

    private class FakeTerminalSessionFactory : TerminalSessionFactory {
        lateinit var session: FakeTerminalSession
        var openCols: Int = 0
        var openRows: Int = 0
        var sessionInputError: RuntimeException? = null
        var openError: RuntimeException? = null
        var exitBeforeReturn: Boolean = false
        var failureBeforeReturn: Throwable? = null
        private lateinit var onOutput: (ByteArray) -> Unit
        private lateinit var onExit: () -> Unit
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
            openError?.let { throw it }
            openCols = cols
            openRows = rows
            this.onOutput = onOutput
            this.onExit = onExit
            this.onFailure = onFailure
            session = FakeTerminalSession(sessionInputError)
            onOutput("ready\n".toByteArray(Charsets.UTF_8))
            if (exitBeforeReturn) onExit()
            failureBeforeReturn?.let(onFailure)
            return session
        }

        fun emitOutput(value: String) {
            onOutput(value.toByteArray(Charsets.UTF_8))
        }

        fun exit() {
            onExit()
        }

        fun fail(error: Throwable) {
            onFailure(error)
        }
    }

    private class FakeTerminalSession(
        private val inputError: RuntimeException? = null,
    ) : TerminalSession {
        override val id: String = "session-1"
        val sentInput = mutableListOf<String>()
        val resizes = mutableListOf<Pair<Int, Int>>()
        var closed = false

        override fun isConnected(): Boolean = !closed

        override fun sendInputBytes(value: ByteArray) {
            inputError?.let { throw it }
            sentInput.add(value.toString(Charsets.UTF_8))
        }

        override fun resize(cols: Int, rows: Int) {
            resizes.add(cols to rows)
        }

        override fun close() {
            closed = true
        }
    }
}
