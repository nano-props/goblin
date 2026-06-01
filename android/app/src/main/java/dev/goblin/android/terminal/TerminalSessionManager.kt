package dev.goblin.android.terminal

import dev.goblin.android.data.TerminalSessionSnapshotStore
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import java.util.UUID

class TerminalSessionManager(
    private val terminalService: TerminalSessionFactory,
    private val clock: () -> Long = System::currentTimeMillis,
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
    private val sessionStore: TerminalSessionSnapshotStore? = null,
) {
    private val lock = Any()
    private val sessions = linkedMapOf<String, TerminalSessionRecord>()
    private val controllers = mutableMapOf<String, TerminalController>()
    private val observers = mutableMapOf<String, MutableMap<String, (TerminalSessionRecord) -> Unit>>()
    private val collectionObservers = mutableMapOf<String, (List<TerminalSessionRecord>) -> Unit>()

    init {
        val restored = sessionStore
            ?.loadSessions()
            ?.map(::staleRunningAsDisconnected)
            .orEmpty()
        if (restored.isNotEmpty()) {
            synchronized(lock) {
                restored.forEach { sessions[it.id] = it }
            }
            sessionStore?.saveSessions(restored)
        }
    }

    fun sessions(): List<TerminalSessionRecord> = synchronized(lock) {
        sortedSessionsLocked()
    }

    fun session(sessionId: String): TerminalSessionRecord? = synchronized(lock) {
        sessions[sessionId]
    }

    fun createOrAttach(
        target: RemoteTarget,
        repositoryId: String?,
        targetLabel: String,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): TerminalSessionRecord {
        findAttachable(target, repositoryId)?.let { return it }
        return createNew(
            target = target,
            repositoryId = repositoryId,
            targetLabel = targetLabel,
            secrets = secrets,
        )
    }

    fun createNew(
        target: RemoteTarget,
        repositoryId: String?,
        targetLabel: String,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): TerminalSessionRecord {
        val sessionId = idGenerator()
        val openedAt = clock()
        val starting = TerminalSessionRecord(
            id = sessionId,
            hostId = target.id,
            repositoryId = repositoryId,
            remotePath = target.remotePath,
            targetLabel = targetLabel,
            status = TerminalSessionStatus.Starting,
            openedAt = openedAt,
            lastActivityAt = openedAt,
        )
        val controller = TerminalController(terminalService = terminalService) { state ->
            handleControllerState(sessionId, state)
        }
        synchronized(lock) {
            sessions[sessionId] = starting
            controllers[sessionId] = controller
        }
        persist(starting)
        notifyObservers(starting)

        controller.open(target, secrets)
        return session(sessionId) ?: starting
    }

    fun sessionsForWorkspace(repositoryId: String, remotePath: String): List<TerminalSessionRecord> =
        synchronized(lock) {
            sessions.values
                .filter { it.repositoryId == repositoryId && it.remotePath == remotePath }
                .sortedWith(workspaceSessionComparator)
        }

    fun mostRecentSessionForWorkspace(repositoryId: String, remotePath: String): TerminalSessionRecord? =
        sessionsForWorkspace(repositoryId, remotePath).firstOrNull()

    fun observeSessions(onChanged: (List<TerminalSessionRecord>) -> Unit): AutoCloseable {
        val observerId = UUID.randomUUID().toString()
        val current = synchronized(lock) {
            collectionObservers[observerId] = onChanged
            sortedSessionsLocked()
        }
        onChanged(current)
        return AutoCloseable {
            synchronized(lock) {
                collectionObservers.remove(observerId)
            }
        }
    }

    fun observe(sessionId: String, onChanged: (TerminalSessionRecord) -> Unit): AutoCloseable {
        val observerId = UUID.randomUUID().toString()
        val current = synchronized(lock) {
            observers.getOrPut(sessionId) { linkedMapOf() }[observerId] = onChanged
            sessions[sessionId]
        }
        if (current != null) onChanged(current)
        return AutoCloseable {
            synchronized(lock) {
                observers[sessionId]?.remove(observerId)
                if (observers[sessionId]?.isEmpty() == true) observers.remove(sessionId)
            }
        }
    }

    fun sendInput(sessionId: String, value: String): Boolean {
        val controller = synchronized(lock) { controllers[sessionId] } ?: return false
        val sent = controller.sendInput(value)
        if (sent) {
            updateSession(sessionId) {
                it.copy(lastActivityAt = clock())
            }
        }
        return sent
    }

    fun paste(sessionId: String, value: String): Boolean = sendInput(sessionId, value)

    fun resize(sessionId: String, cols: Int, rows: Int): Boolean {
        val controller = synchronized(lock) { controllers[sessionId] } ?: return false
        return controller.resize(cols, rows)
    }

    fun close(sessionId: String): TerminalSessionRecord? {
        val current = session(sessionId) ?: return null
        if (current.disconnectedReason == TerminalDisconnectedReason.UserClosed) return current

        val controller = synchronized(lock) { controllers[sessionId] }
        if (controller != null) {
            controller.close()
            return session(sessionId)
        }
        return updateSession(sessionId) {
            it.copy(
                status = TerminalSessionStatus.Exited,
                disconnectedReason = TerminalDisconnectedReason.UserClosed,
                foregroundServiceOwned = false,
                lastActivityAt = clock(),
            )
        }
    }

    fun removeSession(sessionId: String): TerminalSessionRecord? {
        val removed = synchronized(lock) {
            val record = sessions.remove(sessionId) ?: return null
            val controller = controllers.remove(sessionId)
            observers.remove(sessionId)
            record to controller
        }
        val (record, controller) = removed
        if (record.status in attachableStatuses) {
            controller?.close()
        }
        sessionStore?.deleteSession(record.id)
        notifyCollectionObservers()
        return record
    }

    fun removeRepositorySessions(repositoryId: String): List<TerminalSessionRecord> {
        val sessionIds = synchronized(lock) {
            sessions.values
                .filter { it.repositoryId == repositoryId }
                .map { it.id }
        }
        return sessionIds.mapNotNull(::removeSession)
    }

    fun removeWorkspaceSessions(repositoryId: String, remotePath: String): List<TerminalSessionRecord> {
        val sessionIds = synchronized(lock) {
            sessions.values
                .filter { it.repositoryId == repositoryId && it.remotePath == remotePath }
                .map { it.id }
        }
        return sessionIds.mapNotNull(::removeSession)
    }

    fun markForegroundServiceOwned(sessionIds: Set<String>) {
        val currentIds = synchronized(lock) { sessions.keys.toList() }
        currentIds.forEach { sessionId ->
            updateSession(sessionId) {
                val owned = it.id in sessionIds && it.status == TerminalSessionStatus.Running
                it.copy(foregroundServiceOwned = owned)
            }
        }
    }

    private fun findAttachable(target: RemoteTarget, repositoryId: String?): TerminalSessionRecord? =
        synchronized(lock) {
            sessions.values.firstOrNull {
                it.hostId == target.id &&
                    it.repositoryId == repositoryId &&
                    it.remotePath == target.remotePath &&
                    it.status in attachableStatuses
            }
        }

    private fun handleControllerState(sessionId: String, state: TerminalSessionState) {
        when (state) {
            TerminalSessionState.Idle -> Unit
            TerminalSessionState.Connecting -> updateSession(sessionId) {
                it.copy(status = TerminalSessionStatus.Starting)
            }
            is TerminalSessionState.Connected -> updateSession(sessionId) {
                it.copy(
                    status = TerminalSessionStatus.Running,
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    disconnectedReason = null,
                )
            }
            is TerminalSessionState.Resizing -> updateSession(sessionId) {
                it.copy(status = TerminalSessionStatus.Running)
            }
            is TerminalSessionState.Exited -> updateSession(sessionId) {
                it.copy(
                    status = TerminalSessionStatus.Exited,
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    foregroundServiceOwned = false,
                    disconnectedReason = state.reason,
                )
            }
            is TerminalSessionState.Failed -> updateSession(sessionId) {
                it.copy(
                    status = state.reason.toInactiveStatus(),
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    foregroundServiceOwned = false,
                    disconnectedReason = state.reason,
                )
            }
            is TerminalSessionState.Disconnected -> updateSession(sessionId) {
                it.copy(
                    status = TerminalSessionStatus.Disconnected,
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    foregroundServiceOwned = false,
                    disconnectedReason = state.reason,
                )
            }
        }
    }

    private fun updateSession(
        sessionId: String,
        transform: (TerminalSessionRecord) -> TerminalSessionRecord,
    ): TerminalSessionRecord? {
        val updated = synchronized(lock) {
            val current = sessions[sessionId] ?: return null
            val next = transform(current)
            if (next == current) return current
            sessions[sessionId] = next
            if (next.status !in attachableStatuses) controllers.remove(sessionId)
            next
        }
        persist(updated)
        notifyObservers(updated)
        return updated
    }

    private fun persist(record: TerminalSessionRecord) {
        if (record.disconnectedReason == TerminalDisconnectedReason.UserClosed) {
            sessionStore?.deleteSession(record.id)
        } else {
            sessionStore?.upsertSession(record)
        }
    }

    private fun staleRunningAsDisconnected(record: TerminalSessionRecord): TerminalSessionRecord {
        val stale = record.status in attachableStatuses || record.foregroundServiceOwned
        if (!stale) return record
        return record.copy(
            status = TerminalSessionStatus.Disconnected,
            foregroundServiceOwned = false,
            disconnectedReason = TerminalDisconnectedReason.AndroidServiceStopped,
            lastActivityAt = record.lastActivityAt ?: record.openedAt,
        )
    }

    private fun notifyObservers(record: TerminalSessionRecord) {
        val callbacks = synchronized(lock) {
            observers[record.id]?.values?.toList().orEmpty()
        }
        callbacks.forEach { it(record) }
        notifyCollectionObservers()
    }

    private fun notifyCollectionObservers() {
        val snapshot = sessions()
        val callbacks = synchronized(lock) {
            collectionObservers.values.toList()
        }
        callbacks.forEach { it(snapshot) }
    }

    private fun sortedSessionsLocked(): List<TerminalSessionRecord> =
        sessions.values.sortedBy { it.openedAt }

    private fun TerminalSessionStatus.workspacePriority(): Int =
        when (this) {
            TerminalSessionStatus.Starting,
            TerminalSessionStatus.Running,
            -> 0
            TerminalSessionStatus.Exited,
            TerminalSessionStatus.Failed,
            TerminalSessionStatus.Disconnected,
            -> 1
        }

    private val workspaceSessionComparator: Comparator<TerminalSessionRecord> =
        compareBy<TerminalSessionRecord> { it.status.workspacePriority() }
            .thenByDescending { it.lastActivityAt ?: it.openedAt }
            .thenBy { it.openedAt }

    private fun TerminalDisconnectedReason.toInactiveStatus(): TerminalSessionStatus =
        when (this) {
            TerminalDisconnectedReason.SshDisconnected,
            TerminalDisconnectedReason.AndroidServiceStopped,
            -> TerminalSessionStatus.Disconnected
            TerminalDisconnectedReason.UserClosed,
            TerminalDisconnectedReason.RemoteExited,
            -> TerminalSessionStatus.Exited
            TerminalDisconnectedReason.TerminalFailure -> TerminalSessionStatus.Failed
        }

    private companion object {
        val attachableStatuses = setOf(TerminalSessionStatus.Starting, TerminalSessionStatus.Running)
    }
}

object TerminalSessionRuntime {
    private var manager: TerminalSessionManager? = null

    fun manager(
        terminalService: TerminalSessionFactory,
        sessionStore: TerminalSessionSnapshotStore? = null,
    ): TerminalSessionManager =
        synchronized(this) {
            manager ?: TerminalSessionManager(
                terminalService = terminalService,
                sessionStore = sessionStore,
            ).also { manager = it }
        }
}
