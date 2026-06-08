package dev.goblin.android.terminals

import dev.goblin.android.data.TerminalSessionSnapshotStore
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import dev.goblin.android.terminals.emulator.RemoteTerminalEmulatorController
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class TerminalSessionManager(
    private val terminalService: TerminalSessionFactory,
    private val clock: () -> Long = System::currentTimeMillis,
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
    private val sessionStore: TerminalSessionSnapshotStore? = null,
    private val heartbeatIntervalSeconds: () -> Long = { TerminalHeartbeatIntervalSeconds },
    private val heartbeatFailureThreshold: () -> Int = { TerminalHeartbeatFailureThreshold },
    private val terminalWriteTimeoutMillis: () -> Long = { TerminalWriteTimeoutMillis },
    private val terminalIoExecutor: Executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "goblin-terminal-io").apply { isDaemon = true }
    },
    private val terminalCloseExecutor: Executor = Executors.newCachedThreadPool { task ->
        Thread(task, "goblin-terminal-close").apply { isDaemon = true }
    },
    private val emulatorControllerFactory: (
        sessionId: String,
        sendInputBytes: (ByteArray) -> Boolean,
        resizeRemote: (Int, Int) -> Boolean,
    ) -> RemoteTerminalEmulatorController = { sessionId, sendInputBytes, resizeRemote ->
        RemoteTerminalEmulatorController(
            sessionId = sessionId,
            sendInputBytes = sendInputBytes,
            resizeRemote = resizeRemote,
        )
    },
) {
    private val lock = Any()
    private val sessions = linkedMapOf<String, TerminalSessionRecord>()
    private val controllers = mutableMapOf<String, TerminalController>()
    private val emulatorControllers = mutableMapOf<String, RemoteTerminalEmulatorController>()
    private val heartbeatFailureStreaks = mutableMapOf<String, Int>()
    private val pendingTerminalWrites = mutableMapOf<String, PendingTerminalWrite>()
    private val observers = mutableMapOf<String, MutableMap<String, (TerminalSessionRecord) -> Unit>>()
    private val collectionObservers = mutableMapOf<String, (List<TerminalSessionRecord>) -> Unit>()
    private val heartbeatScheduler = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "goblin-terminal-heartbeat").apply { isDaemon = true }
    }
    private var nextHeartbeatRunAt = 0L
    private var nextTerminalWriteId = 0L

    init {
        val restored = sessionStore
            ?.loadSessions()
            ?.map(::staleRunningAsDisconnected)
            ?.let(::normalizeTerminalSessionDisplayNames)
            .orEmpty()
        if (restored.isNotEmpty()) {
            synchronized(lock) {
                restored.forEach { sessions[it.id] = it }
            }
            sessionStore?.saveSessions(restored)
        }
        heartbeatScheduler.scheduleWithFixedDelay(
            ::checkTerminalBackgroundHealth,
            1,
            1,
            TimeUnit.SECONDS,
        )
    }

    fun sessions(): List<TerminalSessionRecord> = synchronized(lock) {
        sortedSessionsLocked()
    }

    fun session(sessionId: String): TerminalSessionRecord? = synchronized(lock) {
        sessions[sessionId]
    }

    fun touchSession(sessionId: String): TerminalSessionRecord? = updateSession(sessionId) {
        it.copy(lastActivityAt = clock())
    }

    fun createOrAttach(
        target: RemoteTarget,
        repositoryId: String?,
        targetLabel: String,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): TerminalSessionRecord {
        findAttachable(target, repositoryId)
            ?.let { it -> return touchSession(it.id) ?: it }
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
        val displayName = synchronized(lock) {
            nextWorkspaceTerminalDisplayName(hostId = target.id, remotePath = target.remotePath)
        }
        val starting = TerminalSessionRecord(
            id = sessionId,
            hostId = target.id,
            repositoryId = repositoryId,
            remotePath = target.remotePath,
            targetLabel = targetLabel,
            displayName = displayName,
            status = TerminalSessionStatus.Starting,
            openedAt = openedAt,
            lastActivityAt = openedAt,
        )
        val emulatorController = createEmulatorController(sessionId)
        val controller = TerminalController(
            terminalService = terminalService,
            onRawOutput = emulatorController::appendOutput,
        ) { state ->
            handleControllerState(sessionId, state)
        }
        synchronized(lock) {
            sessions[sessionId] = starting
            controllers[sessionId] = controller
            emulatorControllers[sessionId] = emulatorController
            heartbeatFailureStreaks[sessionId] = 0
        }
        persist(starting)
        notifyObservers(starting)

        controller.open(target, secrets)
        return session(sessionId) ?: starting
    }

    fun reconnect(
        sessionId: String,
        target: RemoteTarget,
        repositoryId: String?,
        targetLabel: String,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): TerminalSessionRecord? {
        val existing = session(sessionId) ?: return null
        if (existing.status in attachableStatuses) return touchSession(sessionId) ?: existing
        val controllerToClose = synchronized(lock) {
            emulatorControllers.remove(sessionId)?.detach()
            pendingTerminalWrites.remove(sessionId)
            controllers.remove(sessionId)
        }
        controllerToClose?.let(::closeTerminalController)

        val starting = existing.copy(
            hostId = target.id,
            repositoryId = repositoryId,
            remotePath = target.remotePath,
            targetLabel = targetLabel,
            status = TerminalSessionStatus.Starting,
            lastActivityAt = clock(),
            foregroundServiceOwned = false,
            disconnectedReason = null,
            disconnectedMessage = null,
        )
        val emulatorController = createEmulatorController(sessionId)
        val controller = TerminalController(
            terminalService = terminalService,
            initialOutput = existing.lastOutputSnapshot,
            onRawOutput = emulatorController::appendOutput,
        ) { state ->
            handleControllerState(sessionId, state)
        }
        synchronized(lock) {
            sessions[sessionId] = starting
            controllers[sessionId] = controller
            emulatorControllers[sessionId] = emulatorController
            heartbeatFailureStreaks[sessionId] = 0
        }
        persist(starting)
        notifyObservers(starting)

        controller.open(target, secrets)
        return session(sessionId)
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

    fun emulatorController(sessionId: String): RemoteTerminalEmulatorController? = synchronized(lock) {
        emulatorControllers[sessionId]
    }

    fun sendInput(sessionId: String, value: String): Boolean =
        sendInputBytes(sessionId, value.toByteArray(Charsets.UTF_8))

    fun sendInputBytes(sessionId: String, value: ByteArray): Boolean {
        val controller = synchronized(lock) { controllers[sessionId] } ?: return false
        if (value.isEmpty()) return false
        val writeId = beginTerminalWrite(sessionId, TerminalWriteOperation.Input)
        terminalIoExecutor.execute {
            var sent = false
            try {
                sent = controller.sendInputBytes(value)
            } finally {
                val stillCurrent = finishTerminalWrite(sessionId, writeId)
                if (sent && stillCurrent) {
                    updateSession(sessionId) {
                        it.copy(lastActivityAt = clock())
                    }
                }
            }
        }
        return true
    }

    fun paste(sessionId: String, value: String): Boolean = sendInput(sessionId, value)

    fun resize(sessionId: String, cols: Int, rows: Int): Boolean {
        val controller = synchronized(lock) { controllers[sessionId] } ?: return false
        val writeId = beginTerminalWrite(sessionId, TerminalWriteOperation.Resize)
        terminalIoExecutor.execute {
            try {
                controller.resize(cols, rows)
            } finally {
                finishTerminalWrite(sessionId, writeId)
            }
        }
        return true
    }

    private fun beginTerminalWrite(sessionId: String, operation: TerminalWriteOperation): Long {
        val timeoutMillis = terminalWriteTimeoutMillis().coerceAtLeast(1L)
        return synchronized(lock) {
            nextTerminalWriteId += 1
            val writeId = nextTerminalWriteId
            pendingTerminalWrites[sessionId] = PendingTerminalWrite(
                id = writeId,
                deadlineAt = clock() + timeoutMillis,
                operation = operation,
            )
            writeId
        }
    }

    private fun finishTerminalWrite(sessionId: String, writeId: Long): Boolean =
        synchronized(lock) {
            val current = pendingTerminalWrites[sessionId]
            if (current?.id != writeId) return@synchronized false
            pendingTerminalWrites.remove(sessionId)
            true
        }

    private fun checkTerminalBackgroundHealth() {
        checkPendingTerminalWrites()
        checkRunningSessionsHeartbeat()
    }

    private fun checkPendingTerminalWrites() {
        val now = clock()
        val expired = synchronized(lock) {
            buildList {
                val iterator = pendingTerminalWrites.entries.iterator()
                while (iterator.hasNext()) {
                    val (sessionId, pending) = iterator.next()
                    if (now < pending.deadlineAt) continue
                    val controller = controllers[sessionId]
                    iterator.remove()
                    if (controller != null) {
                        add(
                            ExpiredTerminalWrite(
                                controller = controller,
                                operation = pending.operation,
                            ),
                        )
                    }
                }
            }
        }
        expired.forEach { expiredWrite ->
            runCatching {
                expiredWrite.controller.disconnectForWriteTimeout(
                    message = expiredWrite.operation.timeoutMessage,
                    closeSession = ::closeTerminalSession,
                )
            }
        }
    }

    private fun closeTerminalController(controller: TerminalController) {
        controller.close(::closeTerminalSession)
    }

    private fun closeTerminalSession(session: TerminalSession) {
        terminalCloseExecutor.execute {
            runCatching {
                session.close()
            }
        }
    }

    fun close(sessionId: String): TerminalSessionRecord? {
        val current = session(sessionId) ?: return null
        if (current.disconnectedReason == TerminalDisconnectedReason.UserClosed) return current

        val controller = synchronized(lock) { controllers[sessionId] }
        if (controller != null) {
            closeTerminalController(controller)
            return session(sessionId)
        }
        return updateSession(sessionId) {
            it.copy(
                status = TerminalSessionStatus.Exited,
                disconnectedReason = TerminalDisconnectedReason.UserClosed,
                disconnectedMessage = "User closed",
                foregroundServiceOwned = false,
                lastActivityAt = clock(),
            )
        }
    }

    fun removeSession(sessionId: String): TerminalSessionRecord? {
        val removed = synchronized(lock) {
            val record = sessions.remove(sessionId) ?: return null
            val controller = controllers.remove(sessionId)
            val emulatorController = emulatorControllers.remove(sessionId)
            heartbeatFailureStreaks.remove(sessionId)
            pendingTerminalWrites.remove(sessionId)
            observers.remove(sessionId)
            Triple(record, controller, emulatorController)
        }
        val (record, controller, emulatorController) = removed
        emulatorController?.detach()
        if (record.status in attachableStatuses) {
            controller?.let(::closeTerminalController)
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

    private fun checkRunningSessionsHeartbeat() {
        val now = clock()
        val intervalSeconds = heartbeatIntervalSeconds()
            .coerceIn(MinTerminalHeartbeatIntervalSeconds..MaxTerminalHeartbeatIntervalSeconds)
        val failureThreshold = heartbeatFailureThreshold()
            .coerceIn(MinTerminalHeartbeatFailureThreshold..MaxTerminalHeartbeatFailureThreshold)
        if (nextHeartbeatRunAt == 0L) {
            nextHeartbeatRunAt = now + intervalSeconds * 1000L
            return
        }
        if (now < nextHeartbeatRunAt) return
        nextHeartbeatRunAt = now + intervalSeconds * 1000L

        val runningSessionControllers = synchronized(lock) {
            sessions.values
                .asSequence()
                .filter { it.status == TerminalSessionStatus.Running }
                .mapNotNull { session ->
                    val id = session.id
                    controllers[id]?.let { id to it }
                }
                .toList()
        }
        if (runningSessionControllers.isEmpty()) return
        runningSessionControllers.forEach { (sessionId, controller) ->
            val alive = runCatching { controller.isConnected() }.getOrDefault(false)
            val shouldDisconnect = synchronized(lock) {
                if (alive) {
                    heartbeatFailureStreaks.remove(sessionId)
                    false
                } else {
                    val nextFailureCount = (heartbeatFailureStreaks[sessionId] ?: 0) + 1
                    heartbeatFailureStreaks[sessionId] = nextFailureCount
                    nextFailureCount >= failureThreshold
                }
            }
            if (shouldDisconnect) {
                runCatching { controller.disconnectForHeartbeat() }
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

    private fun createEmulatorController(sessionId: String): RemoteTerminalEmulatorController =
        emulatorControllerFactory(
            sessionId,
            { bytes -> sendInputBytes(sessionId, bytes) },
            { cols, rows -> resize(sessionId, cols, rows) },
        )

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
                    disconnectedMessage = null,
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
                    disconnectedMessage = terminalDisconnectedMessageSnapshot(state.exitMessage),
                )
            }
            is TerminalSessionState.Failed -> updateSession(sessionId) {
                it.copy(
                    status = state.reason.toInactiveStatus(),
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    foregroundServiceOwned = false,
                    disconnectedReason = state.reason,
                    disconnectedMessage = terminalDisconnectedMessageSnapshot(state.message),
                )
            }
            is TerminalSessionState.Disconnected -> updateSession(sessionId) {
                it.copy(
                    status = TerminalSessionStatus.Disconnected,
                    lastOutputSnapshot = terminalOutputSnapshot(state.output),
                    lastActivityAt = clock(),
                    foregroundServiceOwned = false,
                    disconnectedReason = state.reason,
                    disconnectedMessage = terminalDisconnectedMessageSnapshot(state.message),
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
            if (next.status !in attachableStatuses) {
                controllers.remove(sessionId)
                heartbeatFailureStreaks.remove(sessionId)
                pendingTerminalWrites.remove(sessionId)
            }
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
            disconnectedMessage = "Android service stopped",
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

    private fun nextWorkspaceTerminalDisplayName(hostId: String, remotePath: String): String {
        val normalizedPath = terminalSessionRemotePath(remotePath)
        val workspaceSessions = sessions.values
            .asSequence()
            .filter { it.hostId == hostId && terminalSessionRemotePath(it.remotePath) == normalizedPath }
            .toList()
        val maxIndex = workspaceSessions
            .mapNotNull { terminalDisplayNameIndex(it.displayName) }
            .maxOrNull() ?: 0
        if (maxIndex == 0) {
            return terminalSessionDisplayNameFromIndex(workspaceSessions.size + 1)
        }
        return terminalSessionDisplayNameFromIndex(maxIndex + 1)
    }

    private fun normalizeTerminalSessionDisplayNames(sessions: List<TerminalSessionRecord>): List<TerminalSessionRecord> {
        if (sessions.isEmpty()) return sessions

        val updatedById = sessions.associateBy { it.id }.toMutableMap()
        val sessionsByWorkspace = sessions.groupBy { it.hostId to terminalSessionRemotePath(it.remotePath) }
        sessionsByWorkspace.values.forEach { workspaceSessions ->
            val orderedSessions = workspaceSessions
                .sortedWith(compareBy<TerminalSessionRecord> { it.openedAt }.thenBy { it.id })
            val usedIndices = orderedSessions
                .mapNotNull { terminalDisplayNameIndex(it.displayName) }
                .toMutableSet()
            var nextIndex = 1

            orderedSessions.forEach { session ->
                if (terminalDisplayNameIndex(session.displayName) != null) return@forEach
                while (usedIndices.contains(nextIndex)) {
                    nextIndex += 1
                }
                updatedById[session.id] = session.copy(displayName = terminalSessionDisplayNameFromIndex(nextIndex))
                usedIndices.add(nextIndex)
                nextIndex += 1
            }
        }
        return sessions.map { updatedById[it.id] ?: it }
    }

    private fun terminalDisplayNameIndex(displayName: String): Int? =
        TerminalDisplayNamePattern.matchEntire(displayName)?.groupValues?.getOrNull(1)?.toIntOrNull()

    private fun terminalSessionDisplayNameFromIndex(index: Int): String = "terminal-$index"

    private fun terminalSessionRemotePath(remotePath: String): String =
        remotePath.ifBlank { "/" }.trimEnd('/').ifEmpty { "/" }

    private fun TerminalDisconnectedReason.toInactiveStatus(): TerminalSessionStatus =
        when (this) {
            TerminalDisconnectedReason.SshDisconnected,
            TerminalDisconnectedReason.AndroidServiceStopped,
            TerminalDisconnectedReason.TerminalWriteTimeout,
            -> TerminalSessionStatus.Disconnected
            TerminalDisconnectedReason.UserClosed,
            TerminalDisconnectedReason.RemoteExited,
            -> TerminalSessionStatus.Exited
            TerminalDisconnectedReason.TerminalFailure -> TerminalSessionStatus.Failed
        }

    private companion object {
        val attachableStatuses = setOf(TerminalSessionStatus.Starting, TerminalSessionStatus.Running)
        val TerminalDisplayNamePattern = Regex("^terminal-(\\d+)$")
    }

    private data class PendingTerminalWrite(
        val id: Long,
        val deadlineAt: Long,
        val operation: TerminalWriteOperation,
    )

    private data class ExpiredTerminalWrite(
        val controller: TerminalController,
        val operation: TerminalWriteOperation,
    )

    private enum class TerminalWriteOperation(val timeoutMessage: String) {
        Input("Terminal input write timed out."),
        Resize("Terminal resize timed out."),
    }
}

object TerminalSessionRuntime {
    private var manager: TerminalSessionManager? = null

    fun manager(
        terminalService: TerminalSessionFactory,
        sessionStore: TerminalSessionSnapshotStore? = null,
        heartbeatIntervalSeconds: () -> Long = { TerminalHeartbeatIntervalSeconds },
        heartbeatFailureThreshold: () -> Int = { TerminalHeartbeatFailureThreshold },
    ): TerminalSessionManager =
        synchronized(this) {
            manager ?: TerminalSessionManager(
                terminalService = terminalService,
                sessionStore = sessionStore,
                heartbeatIntervalSeconds = heartbeatIntervalSeconds,
                heartbeatFailureThreshold = heartbeatFailureThreshold,
            ).also { manager = it }
        }
}
