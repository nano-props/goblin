package dev.goblin.android.ssh

import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSessionStatus
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SshPortForwardServiceTest {
    @Test
    fun `manager starts active session with assigned backend port`() {
        val backend = FakePortForwardBackend()
        val manager = PortForwardManager(backend)
        val session = manager.start(owner(), target(), PortForwardRequest.create(remotePort = 3000))

        assertEquals(PortForwardSessionStatus.Active, session.status)
        assertEquals(49152, session.localPort)
        assertEquals("http://127.0.0.1:49152", session.localUrl)
        assertEquals(listOf(session), manager.sessions(ownerId = "repo-1"))
    }

    @Test
    fun `manager stops active session and closes backend handle`() {
        val backend = FakePortForwardBackend()
        val manager = PortForwardManager(backend)
        val session = manager.start(owner(), target(), PortForwardRequest.create(remotePort = 3000))

        val stopped = manager.stop(session.id)

        require(stopped != null)
        assertEquals(PortForwardSessionStatus.Stopped, stopped.status)
        assertEquals(session.id, stopped.id)
        assertEquals(1, backend.handles.single().closeCount)
    }

    @Test
    fun `manager records failed session when backend cannot open tunnel`() {
        val manager = PortForwardManager(FailingPortForwardBackend("connection refused"))

        val session = manager.start(owner(), target(), PortForwardRequest.create(remotePort = 3000))

        assertEquals(PortForwardSessionStatus.Failed, session.status)
        assertEquals("connection refused", session.message)
        assertEquals(listOf(session), manager.sessions(ownerId = "repo-1"))
    }

    @Test
    fun `owner cleanup stops only matching active sessions`() {
        val backend = FakePortForwardBackend()
        val manager = PortForwardManager(backend)
        val first = manager.start(owner(id = "repo-1"), target(), PortForwardRequest.create(remotePort = 3000))
        val second = manager.start(owner(id = "repo-2"), target(), PortForwardRequest.create(remotePort = 4000))

        val stopped = manager.stopOwner("repo-1")

        assertEquals(listOf(first.id), stopped.map { it.id })
        assertEquals(PortForwardSessionStatus.Stopped, manager.sessions().first { it.id == first.id }.status)
        assertEquals(PortForwardSessionStatus.Active, manager.sessions().first { it.id == second.id }.status)
        assertTrue(backend.handles.first().closed)
        assertFalse(backend.handles.last().closed)
    }

    private fun owner(id: String = "repo-1"): PortForwardOwner =
        PortForwardOwner(id = id, label = "App")

    private fun target(): RemoteTarget = RemoteTarget(
        id = "root@example.com:22/srv/app",
        alias = "Dev",
        host = "example.com",
        user = "root",
        port = 22,
        remotePath = "/srv/app",
        identityRefId = "identity-1",
    )
}

private class FakePortForwardBackend : PortForwardBackend {
    val handles = mutableListOf<FakeActivePortForward>()

    override fun open(target: RemoteTarget, request: PortForwardRequest): ActivePortForward {
        val handle = FakeActivePortForward(localPort = request.localPort.takeIf { it > 0 } ?: 49152)
        handles += handle
        return handle
    }
}

private class FailingPortForwardBackend(
    private val message: String,
) : PortForwardBackend {
    override fun open(target: RemoteTarget, request: PortForwardRequest): ActivePortForward =
        throw IllegalStateException(message)
}

private class FakeActivePortForward(
    override val localPort: Int,
) : ActivePortForward {
    var closeCount = 0
    val closed: Boolean get() = closeCount > 0

    override fun close() {
        closeCount += 1
    }
}

