package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget

class RemoteBranchService(
    private val client: SshClientFacade,
    private val hostKeyStore: HostKeyTrustStore,
) {
    fun createAndCheckoutBranch(target: RemoteTarget, baseBranch: String, newBranch: String) {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = "git -C ${shellQuote(target.remotePath)} checkout -b ${shellQuote(newBranch)} ${shellQuote(baseBranch)}",
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote branch create failed" } } }
    }

    fun deleteBranch(target: RemoteTarget, branch: String) {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = "git -C ${shellQuote(target.remotePath)} branch -d ${shellQuote(branch)}",
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote branch delete failed" } } }
    }

    fun checkoutBranch(target: RemoteTarget, branch: String) {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = "git -C ${shellQuote(target.remotePath)} checkout ${shellQuote(branch)}",
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote branch checkout failed" } } }
    }

    private fun trustedFingerprint(target: RemoteTarget): String {
        val fingerprint = client.fetchHostFingerprint(target)
        require(hostKeyStore.evaluate(target, fingerprint) is HostKeyTrust.Trusted) {
            "Trust this host key before changing remote branches."
        }
        return fingerprint
    }
}

private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"
