package dev.goblin.android.terminal

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalSessionStateTest {
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

    private class ControlledTerminalSessionFactory : TerminalSessionFactory {
        private lateinit var onFailure: (Throwable) -> Unit

        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (String) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession {
            this.onFailure = onFailure
            return object : TerminalSession {
                override val id: String = "session-1"
                override fun sendInput(value: String) = Unit
                override fun resize(cols: Int, rows: Int) = Unit
                override fun close() = Unit
            }
        }

        fun fail(error: Throwable) {
            onFailure(error)
        }
    }
}

