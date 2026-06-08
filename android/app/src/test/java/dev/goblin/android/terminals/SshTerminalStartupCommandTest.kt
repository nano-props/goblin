package dev.goblin.android.terminals

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SshTerminalStartupCommandTest {
    @Test
    fun `workspace shell sends cd input for selected remote path`() {
        assertEquals(
            "cd '/srv/app' && pwd\r",
            SshTerminalStartupCommand.initialInputForRemotePath("/srv/app"),
        )
    }

    @Test
    fun `workspace shell quotes paths without replacing the interactive shell`() {
        val command = SshTerminalStartupCommand.initialInputForRemotePath("/srv/app's worktree")

        assertEquals("cd '/srv/app'\"'\"'s worktree' && pwd\r", command)
        assertFalse(command.orEmpty().contains("exec "))
    }

    @Test
    fun `root path does not inject startup input`() {
        assertEquals(null, SshTerminalStartupCommand.initialInputForRemotePath("/"))
    }

    @Test
    fun `startup input failure output includes exception class when message is blank`() {
        val output = SshTerminalStartupCommand.startupInputFailureOutput(BlankMessageException())

        assertTrue(output.contains("Startup cd failed"))
        assertTrue(output.contains("BlankMessageException"))
    }

    private class BlankMessageException : RuntimeException()
}
