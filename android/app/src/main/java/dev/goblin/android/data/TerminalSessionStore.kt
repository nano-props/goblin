package dev.goblin.android.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.goblin.android.terminals.TerminalDisconnectedReason
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.terminals.terminalOutputSnapshot
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
    private const val LegacyRecordFieldCount = 11
    private const val RecordFieldCount = 12

    fun encode(sessions: List<TerminalSessionRecord>): String =
        sessions.joinToString(RecordSeparator) { session ->
            listOf(
                session.id,
                session.hostId,
                session.repositoryId.orEmpty(),
                session.remotePath,
                session.targetLabel,
                session.displayName,
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
            .mapIndexedNotNull(::decodeSession)
            .toList()
    }

    private fun decodeSession(index: Int, line: String): TerminalSessionRecord? {
        val fields = line.split(FieldSeparator).map { it.decodeField() }
        if (fields.size !in listOf(LegacyRecordFieldCount, RecordFieldCount)) return null
        return runCatching {
            TerminalSessionRecord(
                id = fields[0],
                hostId = fields[1],
                repositoryId = fields[2].takeIf { it.isNotBlank() },
                remotePath = fields[3],
                targetLabel = fields[4],
                displayName = fields[5].takeIf { fields.size == RecordFieldCount } ?: "",
                status = TerminalSessionStatus.valueOf(if (fields.size == RecordFieldCount) fields[6] else fields[5]),
                lastOutputSnapshot = terminalOutputSnapshot(if (fields.size == RecordFieldCount) fields[7] else fields[6]),
                lastActivityAt = (if (fields.size == RecordFieldCount) fields[8] else fields[7]).takeIf { it.isNotBlank() }?.toLong(),
                openedAt = (if (fields.size == RecordFieldCount) fields[9] else fields[8]).toLong(),
                foregroundServiceOwned = (if (fields.size == RecordFieldCount) fields[10] else fields[9]).toBooleanStrict(),
                disconnectedReason = (if (fields.size == RecordFieldCount) fields[11] else fields[10]).takeIf { it.isNotBlank() }?.let(
                    TerminalDisconnectedReason::valueOf,
                ),
            )
        }.getOrNull()
    }

    private fun String.encodeField(): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(toByteArray(StandardCharsets.UTF_8))

    private fun String.decodeField(): String =
        String(Base64.getUrlDecoder().decode(this), StandardCharsets.UTF_8)
}
