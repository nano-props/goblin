package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TermuxCommandBuilderTest {
    @Test
    fun `ssh command targets selected workspace with interactive shell`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 2222,
                remotePath = "/srv/app",
            ),
        )

        assertEquals(
            "ssh -p 2222 'root@example.com' -t 'cd '\\''/srv/app'\\'' && exec \"\${SHELL:-sh}\"'",
            command,
        )
    }

    @Test
    fun `ssh command shell quotes paths with spaces and single quotes`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "deployer",
                host = "example.com",
                port = 22,
                remotePath = "/srv/app's worktree",
            ),
        )
        val expectedRemoteCommand = "cd '/srv/app'\\''s worktree' && exec \"\${SHELL:-sh}\""

        assertEquals(
            "ssh -p 22 'deployer@example.com' -t ${TermuxCommandBuilder.shellQuote(expectedRemoteCommand)}",
            command,
        )
    }

    @Test
    fun `shell quote handles embedded single quotes`() {
        assertEquals("'plain'", TermuxCommandBuilder.shellQuote("plain"))
        assertEquals("'/srv/app'\\''s worktree'", TermuxCommandBuilder.shellQuote("/srv/app's worktree"))
    }

    @Test
    fun `remote target conversion preserves host port user and path`() {
        val target = RemoteTarget(
            id = "host-1",
            alias = "Dev",
            host = "example.com",
            user = "root",
            port = 2200,
            remotePath = "/srv/app",
            identityRefId = "identity-1",
        )

        assertEquals(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 2200,
                remotePath = "/srv/app",
            ),
            TermuxCommandBuilder.fromRemoteTarget(target),
        )
    }

    @Test
    fun `invalid targets are rejected before command construction`() {
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "", host = "example.com", port = 22, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "", port = 22, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "example.com", port = 0, remotePath = "/srv/app")
        }
        assertThrows(IllegalArgumentException::class.java) {
            TermuxSshTarget(user = "root", host = "example.com", port = 22, remotePath = "srv/app")
        }
    }

    @Test
    fun `command contains only ssh handoff primitives`() {
        val command = TermuxCommandBuilder.sshWorkspaceCommand(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 22,
                remotePath = "/srv/app",
            ),
        )

        assertTrue(command.startsWith("ssh -p 22 "))
        assertTrue(command.contains(" -t "))
        assertTrue(command.contains("cd "))
        assertTrue(command.contains("exec \"\${SHELL:-sh}\""))
        assertTrue(!command.contains(" -l"))
    }

    @Test
    fun `stdin private key command writes private key to termux tmp and schedules cleanup`() {
        val expectedRemoteCommand = "cd ${TermuxCommandBuilder.shellQuote("/srv/app's worktree")} " +
            "&& exec \"\${SHELL:-sh}\""
        val command = TermuxCommandBuilder.sshWorkspaceCommandWithStdinPrivateKey(
            TermuxSshTarget(
                user = "root",
                host = "example.com",
                port = 22,
                remotePath = "/srv/app's worktree",
            ),
        )

        assertTrue(command.contains("tmp_dir=\"\${TMPDIR:-\$PREFIX/tmp}\""))
        assertTrue(command.contains("mkdir -p \"\$tmp_dir\""))
        assertTrue(command.contains("key_file=\$(mktemp \"\$tmp_dir/goblin-key.XXXXXX\")"))
        assertTrue(command.contains("cleanup_key() { rm -f \"\$key_file\"; }"))
        assertTrue(command.contains("trap cleanup_key EXIT"))
        assertTrue(command.contains("cat > \"\$key_file\""))
        assertTrue(command.contains("chmod 600 \"\$key_file\""))
        assertTrue(command.contains("( sleep 60; cleanup_key ) >/dev/null 2>&1 &"))
        assertTrue(command.contains("exec </dev/tty"))
        assertTrue(command.contains("ssh -i \"\$key_file\" -o IdentitiesOnly=yes -p 22 'root@example.com'"))
        assertTrue(command.contains(TermuxCommandBuilder.shellQuote(expectedRemoteCommand)))
        assertTrue(command.contains("exec \"\${SHELL:-sh}\""))
        assertTrue(!command.contains(" -l"))
    }

}
