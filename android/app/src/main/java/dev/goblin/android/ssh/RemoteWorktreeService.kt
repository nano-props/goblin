package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.RemoteTarget

class RemoteWorktreeService(
    private val client: SshClientFacade,
    private val hostKeyStore: HostKeyTrustStore,
) {
    fun createWorktree(target: RemoteTarget, branch: String, worktreePath: String) {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = "git -C ${shellQuote(target.remotePath)} worktree add ${shellQuote(worktreePath)} ${shellQuote(branch)}",
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote worktree create failed" } } }
    }

    fun removeWorktree(target: RemoteTarget, worktree: RemoteRepositoryWorktree) {
        val safety = evaluateWorktreeRemoval(worktree)
        require(safety.allowed) { safety.reason ?: "Remote worktree remove is blocked" }
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = "git -C ${shellQuote(target.remotePath)} worktree remove ${shellQuote(worktree.path)}",
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote worktree remove failed" } } }
    }

    private fun trustedFingerprint(target: RemoteTarget): String {
        val fingerprint = client.fetchHostFingerprint(target)
        require(hostKeyStore.evaluate(target, fingerprint) is HostKeyTrust.Trusted) {
            "Trust this host key before changing remote worktrees."
        }
        return fingerprint
    }
}

data class WorktreeRemovalSafety(
    val allowed: Boolean,
    val reason: String?,
)

fun evaluateWorktreeRemoval(worktree: RemoteRepositoryWorktree): WorktreeRemovalSafety = when {
    worktree.isPrimary -> WorktreeRemovalSafety(false, "Primary worktree cannot be removed.")
    worktree.isDirty -> WorktreeRemovalSafety(false, "Dirty worktree cannot be removed.")
    worktree.isLocked -> WorktreeRemovalSafety(false, "Locked worktree cannot be removed.")
    worktree.isMissing -> WorktreeRemovalSafety(false, "Missing worktree cleanup is not supported here.")
    isProtectedBranch(worktree.branch) -> WorktreeRemovalSafety(false, "Protected branch worktree cannot be removed.")
    else -> WorktreeRemovalSafety(true, null)
}

fun worktreeRemovalConfirmationText(worktree: RemoteRepositoryWorktree): String =
    "Remove remote worktree ${worktree.path} from the SSH server? This does not delete the branch."

private fun isProtectedBranch(branch: String?): Boolean {
    val value = branch ?: return false
    return value == "main" || value == "master" || value == "develop" || value.startsWith("release/")
}

private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"
