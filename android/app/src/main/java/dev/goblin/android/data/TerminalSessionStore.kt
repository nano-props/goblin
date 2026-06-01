package dev.goblin.android.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.goblin.android.terminal.TerminalDisconnectedReason
import dev.goblin.android.terminal.TerminalSessionRecord
import dev.goblin.android.terminal.TerminalSessionStatus
import dev.goblin.android.terminal.terminalOutputSnapshot
import java.nio.charset.StandardCharsets
import java.util.Base64

interface TerminalSessionSnapshotStore {
    fun loadSessions(): List<TerminalSessionRecord>

    fun saveSessions(sessions: List<TerminalSessionRecord>)

    fun upsertSession(session: TerminalSessionRecord) {
        saveSessions(TerminalSessionStorePolicy.upsert(loadSessions(), session))
    }

    fun deleteSession(sessionId: String) {
        saveSessions(TerminalSessionStorePolicy.delete(loadSessions(), sessionId))
    }
}

class TerminalSessionStore private constructor(
    private val preferences: SharedPreferences,
) : TerminalSessionSnapshotStore {
    override fun loadSessions(): List<TerminalSessionRecord> =
        TerminalSessionCodec.decode(preferences.getString(KeySessions, "").orEmpty())

    override fun saveSessions(sessions: List<TerminalSessionRecord>) {
        preferences.edit { putString(KeySessions, TerminalSessionCodec.encode(sessions)) }
    }

    companion object {
        private const val PreferencesName = "goblin-terminal-sessions"
        private const val KeySessions = "terminal-sessions"

        fun create(context: Context): TerminalSessionStore =
            TerminalSessionStore(context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE))
    }
}

object TerminalSessionStorePolicy {
    fun upsert(
        sessions: List<TerminalSessionRecord>,
        session: TerminalSessionRecord,
    ): List<TerminalSessionRecord> {
        var replaced = false
        val next = sessions.map {
            if (it.id == session.id) {
                replaced = true
                session
            } else {
                it
            }
        }
        return if (replaced) next else sessions + session
    }

    fun delete(
        sessions: List<TerminalSessionRecord>,
        sessionId: String,
    ): List<TerminalSessionRecord> = sessions.filterNot { it.id == sessionId }
}

object TerminalSessionCodec {
    private const val FieldSeparator = "."
    private const val RecordSeparator = "\n"

    fun encode(sessions: List<TerminalSessionRecord>): String =
        sessions.joinToString(RecordSeparator) { session ->
            listOf(
                session.id,
                session.hostId,
                session.repositoryId.orEmpty(),
                session.remotePath,
                session.targetLabel,
                session.status.name,
                terminalOutputSnapshot(session.lastOutputSnapshot),
                session.lastActivityAt?.toString().orEmpty(),
                session.openedAt.toString(),
                session.foregroundServiceOwned.toString(),
                session.disconnectedReason?.name.orEmpty(),
            ).joinToString(FieldSeparator) { it.encodeField() }
        }

    fun decode(payload: String): List<TerminalSessionRecord> {
        if (payload.isBlank()) return emptyList()
        return payload.lineSequence()
            .filter { it.isNotBlank() }
            .mapNotNull(::decodeSession)
            .toList()
    }

    private fun decodeSession(line: String): TerminalSessionRecord? {
        val fields = line.split(FieldSeparator).map { it.decodeField() }
        if (fields.size != 11) return null
        return runCatching {
            TerminalSessionRecord(
                id = fields[0],
                hostId = fields[1],
                repositoryId = fields[2].takeIf { it.isNotBlank() },
                remotePath = fields[3],
                targetLabel = fields[4],
                status = TerminalSessionStatus.valueOf(fields[5]),
                lastOutputSnapshot = terminalOutputSnapshot(fields[6]),
                lastActivityAt = fields[7].takeIf { it.isNotBlank() }?.toLong(),
                openedAt = fields[8].toLong(),
                foregroundServiceOwned = fields[9].toBooleanStrict(),
                disconnectedReason = fields[10].takeIf { it.isNotBlank() }?.let(TerminalDisconnectedReason::valueOf),
            )
        }.getOrNull()
    }

    private fun String.encodeField(): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(toByteArray(StandardCharsets.UTF_8))

    private fun String.decodeField(): String =
        String(Base64.getUrlDecoder().decode(this), StandardCharsets.UTF_8)
}
