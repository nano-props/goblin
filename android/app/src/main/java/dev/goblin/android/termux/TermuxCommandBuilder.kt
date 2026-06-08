package dev.goblin.android.termux

import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile

data class TermuxSshTarget(
    val user: String,
    val host: String,
    val port: Int,
    val remotePath: String,
) {
    init {
        require(user.isNotBlank()) { "SSH user is required" }
        require(host.isNotBlank()) { "SSH host is required" }
        require(port in SshHostProfile.ValidPortRange) { "SSH port must be in 1..65535" }
        require(remotePath.trim().startsWith("/")) { "Remote path must be absolute" }
    }
}

object TermuxCommandBuilder {
    fun fromRemoteTarget(target: RemoteTarget): TermuxSshTarget =
        TermuxSshTarget(
            user = target.user.trim(),
            host = target.host.trim(),
            port = target.port,
            remotePath = target.remotePath.trim(),
        )

    fun sshWorkspaceCommand(target: TermuxSshTarget): String {
        val userAtHost = "${target.user.trim()}@${target.host.trim()}"
        val remoteCommand = remoteWorkspaceCommand(target.remotePath)
        return "ssh -p ${target.port} ${shellQuote(userAtHost)} -t ${shellQuote(remoteCommand)}"
    }

    fun sshWorkspaceCommandWithStdinPrivateKey(target: TermuxSshTarget): String {
        val userAtHost = "${target.user.trim()}@${target.host.trim()}"
        val remoteCommand = remoteWorkspaceCommand(target.remotePath)
        val sshCommand = "ssh -i \"\$key_file\" -o IdentitiesOnly=yes " +
            "-p ${target.port} ${shellQuote(userAtHost)} -t ${shellQuote(remoteCommand)}"
        return listOf(
            "set -e",
            "tmp_dir=\"\${TMPDIR:-\$PREFIX/tmp}\"",
            "mkdir -p \"\$tmp_dir\"",
            "key_file=\$(mktemp \"\$tmp_dir/goblin-key.XXXXXX\")",
            "cleanup_key() { rm -f \"\$key_file\"; }",
            "trap cleanup_key EXIT",
            "cat > \"\$key_file\"",
            "chmod 600 \"\$key_file\"",
            "( sleep 60; cleanup_key ) >/dev/null 2>&1 &",
            "exec </dev/tty",
            sshCommand,
        ).joinToString("\n")
    }

    private fun remoteWorkspaceCommand(remotePath: String): String =
        "cd ${shellQuote(remotePath.trim())} && exec \"\${SHELL:-sh}\""

    internal fun shellQuote(value: String): String {
        require(value.isNotEmpty()) { "Shell value is required" }
        return "'${value.replace("'", "'\\''")}'"
    }
}
