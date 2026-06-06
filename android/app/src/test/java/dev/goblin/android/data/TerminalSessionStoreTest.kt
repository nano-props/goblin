package dev.goblin.android.data

import dev.goblin.android.terminals.TerminalDisconnectedReason
import dev.goblin.android.terminals.TerminalSessionRecord
import dev.goblin.android.terminals.TerminalSessionStatus
import dev.goblin.android.terminals.terminalOutputSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalSessionStoreTest {
    @Test
    fun `terminal sessions round trip through serialized storage payload`() {
        val record = terminalRecord()

        val decoded = TerminalSessionCodec.decode(TerminalSessionCodec.encode(listOf(record)))

        assertEquals(listOf(record), decoded)
        assertEquals("terminal-1", decoded.single().id)
        assertEquals("host-1", decoded.single().hostId)
        assertEquals("repo-1", decoded.single().repositoryId)
        assertEquals("/srv/app", decoded.single().remotePath)
        assertEquals("terminal-1", decoded.single().displayName)
        assertEquals(TerminalSessionStatus.Disconnected, decoded.single().status)
        assertEquals(250L, decoded.single().lastActivityAt)
        assertEquals("recent output", decoded.single().lastOutputSnapshot)
        assertTrue(decoded.single().foregroundServiceOwned)
        assertEquals(TerminalDisconnectedReason.AndroidServiceStopped, decoded.single().disconnectedReason)
    }

    @Test
    fun `serialized terminal session payload excludes sensitive field names`() {
        val payload = TerminalSessionCodec.encode(listOf(terminalRecord()))

        assertFalse(payload.contains("password", ignoreCase = true))
        assertFalse(payload.contains("passphrase", ignoreCase = true))
        assertFalse(payload.contains("privateKey", ignoreCase = true))
        assertFalse(payload.contains("identityBytes", ignoreCase = true))
        assertFalse(payload.contains("socket", ignoreCase = true))
        assertFalse(payload.contains("handle", ignoreCase = true))
        assertTrue(payload.isNotBlank())
    }

    @Test
    fun `terminal session storage payload keeps output snapshot capped`() {
        val record = terminalRecord(lastOutputSnapshot = terminalOutputSnapshot("x".repeat(40_000)))

        val decoded = TerminalSessionCodec.decode(TerminalSessionCodec.encode(listOf(record))).single()

        assertEquals(TerminalSessionRecord.MaxOutputSnapshotChars, decoded.lastOutputSnapshot.length)
    }

    @Test
    fun `terminal session store policy upserts and deletes records`() {
        val first = terminalRecord(id = "terminal-1")
        val updated = terminalRecord(id = "terminal-1", lastOutputSnapshot = "updated")
        val second = terminalRecord(id = "terminal-2")

        val upserted = TerminalSessionStorePolicy.upsert(listOf(first, second), updated)
        val deleted = TerminalSessionStorePolicy.delete(upserted, "terminal-1")

        assertEquals(listOf(updated, second), upserted)
        assertEquals(listOf(second), deleted)
    }

    private fun terminalRecord(
        id: String = "terminal-1",
        lastOutputSnapshot: String = "recent output",
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = id,
        hostId = "host-1",
        repositoryId = "repo-1",
        remotePath = "/srv/app",
        targetLabel = "App - /srv/app",
        status = TerminalSessionStatus.Disconnected,
        displayName = "terminal-1",
        lastOutputSnapshot = lastOutputSnapshot,
        lastActivityAt = 250L,
        openedAt = 100L,
        foregroundServiceOwned = true,
        disconnectedReason = TerminalDisconnectedReason.AndroidServiceStopped,
    )
}
