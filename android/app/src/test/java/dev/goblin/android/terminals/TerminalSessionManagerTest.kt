package dev.goblin.android.terminals

import dev.goblin.android.data.TerminalSessionSnapshotStore
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalSessionManagerTest {
    @Test
    fun `create new opens separate sessions for the same worktree target`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, ids = terminalIds())

        val first = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        val second = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")

        assertNotEquals(first.id, second.id)
        assertEquals(2, service.openCount)
        assertEquals(listOf("backend-session-1", "backend-session-2"), service.sessions.map { it.id })
        assertEquals(TerminalSessionStatus.Running, manager.session(first.id)?.status)
        assertEquals(TerminalSessionStatus.Running, manager.session(second.id)?.status)
    }

    @Test
    fun `create new uses incremental terminal display names by worktree path`() {
        val manager = terminalSessionManager(FakeTerminalSessionFactory(), ids = terminalIds())

        val first = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        val second = manager.createNew(target(remotePath = "/srv/app/"), repositoryId = "repo-2", targetLabel = "Another - /srv/app")
        val third = manager.createNew(target(remotePath = "/srv/other"), repositoryId = "repo-1", targetLabel = "App - /srv/other")
        val fourth = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-3", targetLabel = "More - /srv/app")

        assertEquals("terminal-1", first.displayName)
        assertEquals("terminal-2", second.displayName)
        assertEquals("terminal-1", third.displayName)
        assertEquals("terminal-3", fourth.displayName)
    }

    @Test
    fun `old sessions without display name get normalized when loading session store`() {
        val manager = terminalSessionManager(
            service = FakeTerminalSessionFactory(),
            ids = terminalIds(),
            store = RecordingTerminalSessionStore(
                initial = listOf(
                    legacyTerminalRecord(id = "terminal-1", remotePath = "/srv/app", openedAt = 2L),
                    legacyTerminalRecord(id = "terminal-2", remotePath = "/srv/app", openedAt = 1L),
                ),
            ),
        )

        val sessions = manager.sessions()
        val normalizedById = sessions.associateBy { it.id }

        assertEquals("terminal-1", normalizedById["terminal-2"]?.displayName)
        assertEquals("terminal-2", normalizedById["terminal-1"]?.displayName)
    }

    @Test
    fun `create or attach keeps existing running session for the same worktree target`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, ids = terminalIds())

        val first = manager.createOrAttach(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        val second = manager.createOrAttach(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")

        assertEquals(first.id, second.id)
        assertEquals(1, service.openCount)
    }

    @Test
    fun `workspace sessions are filtered and ordered by status priority and activity`() {
        var now = 100L
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, now = { now }, ids = terminalIds())

        val olderRunning = manager.createNew(
            target = target(remotePath = "/srv/app"),
            repositoryId = "repo-1",
            targetLabel = "App - /srv/app",
        )
        now = 200L
        service.emitOutput("older", index = 0)

        val inactive = manager.createNew(
            target = target(remotePath = "/srv/app"),
            repositoryId = "repo-1",
            targetLabel = "App - /srv/app",
        )
        now = 300L
        service.exit(index = 1)

        val newerRunning = manager.createNew(
            target = target(remotePath = "/srv/app"),
            repositoryId = "repo-1",
            targetLabel = "App - /srv/app",
        )
        now = 400L
        service.emitOutput("newer", index = 2)

        manager.createNew(target(remotePath = "/srv/other"), repositoryId = "repo-1", targetLabel = "App - /srv/other")
        manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-2", targetLabel = "Other - /srv/app")

        val workspaceSessions = manager.sessionsForWorkspace(repositoryId = "repo-1", remotePath = "/srv/app")

        assertEquals(listOf(newerRunning.id, olderRunning.id, inactive.id), workspaceSessions.map { it.id })
        assertEquals(newerRunning.id, manager.mostRecentSessionForWorkspace("repo-1", "/srv/app")?.id)
        assertNull(manager.mostRecentSessionForWorkspace("repo-1", "/srv/missing"))
    }

    @Test
    fun `collection observer receives current list create and status changes until closed`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, ids = terminalIds())
        val observed = mutableListOf<List<TerminalSessionStatus>>()

        val observer = manager.observeSessions { sessions ->
            observed += sessions.map { it.status }
        }
        assertEquals(listOf(emptyList<TerminalSessionStatus>()), observed)

        manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        assertEquals(listOf(TerminalSessionStatus.Running), observed.last())

        service.exit(index = 0)
        assertEquals(listOf(TerminalSessionStatus.Exited), observed.last())

        val observedCount = observed.size
        observer.close()
        manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")

        assertEquals(observedCount, observed.size)
    }

    @Test
    fun `removing a running terminal closes backend and removes persisted record`() {
        val service = FakeTerminalSessionFactory()
        val store = RecordingTerminalSessionStore()
        val manager = terminalSessionManager(service = service, store = store)
        val record = manager.createNew(target(), repositoryId = "repo-1", targetLabel = "App - /srv/app")

        val removed = manager.removeSession(record.id)

        assertEquals(record.id, removed?.id)
        assertNull(manager.session(record.id))
        assertEquals(1, service.session.closeCount)
        assertTrue(store.loadSessions().none { it.id == record.id })
    }

    @Test
    fun `removing an inactive terminal deletes record without reopening or closing backend`() {
        val service = FakeTerminalSessionFactory()
        val store = RecordingTerminalSessionStore()
        val manager = terminalSessionManager(service = service, store = store)
        val record = manager.createNew(target(), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        service.exit()

        val removed = manager.removeSession(record.id)

        assertEquals(record.id, removed?.id)
        assertNull(manager.session(record.id))
        assertEquals(1, service.openCount)
        assertEquals(0, service.session.closeCount)
        assertTrue(store.loadSessions().none { it.id == record.id })
    }

    @Test
    fun `removing repository terminals only removes matching repository sessions`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, ids = terminalIds())
        val app = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        val feature = manager.createNew(target(remotePath = "/srv/app-feature"), repositoryId = "repo-1", targetLabel = "App - /srv/app-feature")
        val other = manager.createNew(target(remotePath = "/srv/other"), repositoryId = "repo-2", targetLabel = "Other - /srv/other")

        val removed = manager.removeRepositorySessions("repo-1")

        assertEquals(listOf(app.id, feature.id), removed.map { it.id })
        assertNull(manager.session(app.id))
        assertNull(manager.session(feature.id))
        assertEquals(other.id, manager.session(other.id)?.id)
    }

    @Test
    fun `removing workspace terminals only removes matching repository path sessions`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, ids = terminalIds())
        val app = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-1", targetLabel = "App - /srv/app")
        val feature = manager.createNew(target(remotePath = "/srv/app-feature"), repositoryId = "repo-1", targetLabel = "App - /srv/app-feature")
        val otherRepository = manager.createNew(target(remotePath = "/srv/app"), repositoryId = "repo-2", targetLabel = "Other - /srv/app")

        val removed = manager.removeWorkspaceSessions(repositoryId = "repo-1", remotePath = "/srv/app")

        assertEquals(listOf(app.id), removed.map { it.id })
        assertNull(manager.session(app.id))
        assertEquals(feature.id, manager.session(feature.id)?.id)
        assertEquals(otherRepository.id, manager.session(otherRepository.id)?.id)
    }

    @Test
    fun `detaching an observer does not close a running terminal session`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service)
        val record = manager.createOrAttach(target(), repositoryId = "repo-1", targetLabel = "App - /srv/app")

        val observer = manager.observe(record.id) {}
        observer.close()

        assertEquals(TerminalSessionStatus.Running, manager.session(record.id)?.status)
        assertFalse(service.session.closed)
    }

    @Test
    fun `terminal output updates last activity and bounded snapshot`() {
        var now = 100L
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, now = { now })
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        now = 250L
        service.emitOutput("hello")

        val updated = manager.session(record.id)
        assertEquals(250L, updated?.lastActivityAt)
        assertEquals("hello", updated?.lastOutputSnapshot)
    }

    @Test
    fun `terminal input updates last activity`() {
        var now = 100L
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service, now = { now })
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        now = 300L
        assertTrue(manager.sendInput(record.id, "ls\n"))

        assertEquals(300L, manager.session(record.id)?.lastActivityAt)
        assertEquals(listOf("ls\n"), service.session.sentInput)
    }

    @Test
    fun `explicit close marks user closed and closes backend once`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service)
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        manager.close(record.id)
        manager.close(record.id)

        val closed = manager.session(record.id)
        assertEquals(TerminalSessionStatus.Exited, closed?.status)
        assertEquals(TerminalDisconnectedReason.UserClosed, closed?.disconnectedReason)
        assertEquals(1, service.session.closeCount)
    }

    @Test
    fun `remote exit maps to remote exited reason`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service)
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        service.exit()

        val exited = manager.session(record.id)
        assertEquals(TerminalSessionStatus.Exited, exited?.status)
        assertEquals(TerminalDisconnectedReason.RemoteExited, exited?.disconnectedReason)
    }

    @Test
    fun `backend failure maps to ssh disconnected reason`() {
        val service = FakeTerminalSessionFactory()
        val manager = terminalSessionManager(service)
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        service.fail(IOException("connection lost"))

        val failed = manager.session(record.id)
        assertEquals(TerminalSessionStatus.Disconnected, failed?.status)
        assertEquals(TerminalDisconnectedReason.SshDisconnected, failed?.disconnectedReason)
    }

    @Test
    fun `terminal output updates are persisted with bounded snapshot`() {
        val service = FakeTerminalSessionFactory()
        val store = RecordingTerminalSessionStore()
        val manager = terminalSessionManager(service = service, store = store)
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        service.emitOutput("x".repeat(40_000))

        val stored = store.loadSessions().single { it.id == record.id }
        assertEquals(TerminalSessionRecord.MaxOutputSnapshotChars, stored.lastOutputSnapshot.length)
    }

    @Test
    fun `explicit close removes persisted terminal record`() {
        val service = FakeTerminalSessionFactory()
        val store = RecordingTerminalSessionStore()
        val manager = terminalSessionManager(service = service, store = store)
        val record = manager.createOrAttach(target(), repositoryId = null, targetLabel = "Dev - /")

        manager.close(record.id)

        assertTrue(store.loadSessions().none { it.id == record.id })
        assertEquals(TerminalDisconnectedReason.UserClosed, manager.session(record.id)?.disconnectedReason)
    }

    @Test
    fun `stored running record loads as disconnected without opening backend shell`() {
        val service = FakeTerminalSessionFactory()
        val store = RecordingTerminalSessionStore(
            initial = listOf(
                TerminalSessionRecord(
                    id = "terminal-1",
                    hostId = "lee@example.com:22/",
                    repositoryId = null,
                    remotePath = "/",
                    targetLabel = "Dev - /",
                    status = TerminalSessionStatus.Running,
                    lastOutputSnapshot = "last output",
                    lastActivityAt = 250L,
                    openedAt = 100L,
                    foregroundServiceOwned = true,
                    disconnectedReason = null,
                ),
            ),
        )

        val manager = terminalSessionManager(service = service, store = store)

        val restored = manager.session("terminal-1")
        assertEquals(0, service.openCount)
        assertEquals(TerminalSessionStatus.Disconnected, restored?.status)
        assertEquals(TerminalDisconnectedReason.AndroidServiceStopped, restored?.disconnectedReason)
        assertEquals("last output", restored?.lastOutputSnapshot)
    }

    private fun terminalSessionManager(
        service: FakeTerminalSessionFactory,
        now: () -> Long = { 100L },
        store: TerminalSessionSnapshotStore? = null,
        ids: Iterator<String> = listOf("terminal-1").iterator(),
    ): TerminalSessionManager = TerminalSessionManager(
        terminalService = service,
        clock = now,
        idGenerator = { ids.next() },
        sessionStore = store,
    )

    private fun terminalIds(): Iterator<String> = generateSequence(1) { it + 1 }
        .map { "terminal-$it" }
        .iterator()

    private fun target(remotePath: String = "/"): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = remotePath,
        identityRefId = null,
    )

    private class FakeTerminalSessionFactory : TerminalSessionFactory {
        val sessions = mutableListOf<FakeTerminalSession>()
        val session: FakeTerminalSession
            get() = sessions.last()
        var openCount = 0
        private val opened = mutableListOf<OpenedTerminal>()

        override fun openShell(
            target: RemoteTarget,
            secrets: SshConnectionSecrets,
            cols: Int,
            rows: Int,
            onOutput: (String) -> Unit,
            onExit: () -> Unit,
            onFailure: (Throwable) -> Unit,
        ): TerminalSession {
            openCount += 1
            val session = FakeTerminalSession(id = "backend-session-$openCount")
            sessions += session
            opened += OpenedTerminal(onOutput = onOutput, onExit = onExit, onFailure = onFailure)
            return session
        }

        fun emitOutput(value: String, index: Int = opened.lastIndex) {
            opened[index].onOutput(value)
        }

        fun exit(index: Int = opened.lastIndex) {
            opened[index].onExit()
        }

        fun fail(error: Throwable, index: Int = opened.lastIndex) {
            opened[index].onFailure(error)
        }

        private data class OpenedTerminal(
            val onOutput: (String) -> Unit,
            val onExit: () -> Unit,
            val onFailure: (Throwable) -> Unit,
        )
    }

    private class FakeTerminalSession(
        override val id: String,
    ) : TerminalSession {
        val sentInput = mutableListOf<String>()
        var closed = false
        var closeCount = 0

        override fun isConnected(): Boolean = !closed

        override fun sendInput(value: String) {
            sentInput.add(value)
        }

        override fun resize(cols: Int, rows: Int) = Unit

        override fun close() {
            closeCount += 1
            closed = true
        }
    }

    private class RecordingTerminalSessionStore(
        initial: List<TerminalSessionRecord> = emptyList(),
    ) : TerminalSessionSnapshotStore {
        private var records = initial

        override fun loadSessions(): List<TerminalSessionRecord> = records

        override fun saveSessions(sessions: List<TerminalSessionRecord>) {
            records = sessions
        }
    }

    private fun legacyTerminalRecord(
        id: String,
        remotePath: String,
        openedAt: Long,
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = id,
        hostId = "lee@example.com:22/",
        repositoryId = "repo-1",
        remotePath = remotePath,
        targetLabel = "App - $remotePath",
        status = TerminalSessionStatus.Running,
        openedAt = openedAt,
        foregroundServiceOwned = true,
        disconnectedReason = null,
    )
}
