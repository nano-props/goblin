package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ssh.DiagnosticCategory
import dev.goblin.android.domain.ssh.RemoteTarget
import java.io.Reader
import java.io.StringReader
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.keyprovider.OpenSSHKeyFile
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource

enum class SshDiagnosticProbe {
    CheckShell,
    CheckGit,
    TestPath,
    RevParseTopLevel,
}

data class SshConnectionSecrets(
    val identityBytes: ByteArray? = null,
    val passphrase: CharArray? = null,
    val acceptedHostFingerprint: String? = null,
)

data class SshCommandResult(
    val ok: Boolean,
    val stdout: String = "",
    val stderr: String = "",
    val message: String = "",
)

class SshClientException(
    val category: DiagnosticCategory,
    override val message: String,
    override val cause: Throwable? = null,
) : RuntimeException(message, cause)

interface SshClientFacade {
    fun fetchHostFingerprint(target: RemoteTarget): String

    fun runDiagnosticProbe(
        target: RemoteTarget,
        probe: SshDiagnosticProbe,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): SshCommandResult
}

class SshjClientFacade(
    private val identityStore: SecureIdentityStore? = null,
) : SshClientFacade {
    override fun fetchHostFingerprint(target: RemoteTarget): String {
        var fingerprint: String? = null
        SSHClient().use { client ->
            client.addHostKeyVerifier(capturingVerifier { fingerprint = it })
            client.connect(target.host, target.port)
        }
        return fingerprint ?: throw SshClientException(DiagnosticCategory.HostKey, "Unable to read host key fingerprint")
    }

    override fun runDiagnosticProbe(
        target: RemoteTarget,
        probe: SshDiagnosticProbe,
        secrets: SshConnectionSecrets,
    ): SshCommandResult = withAuthenticatedClient(target, secrets) { client ->
        client.startSession().use { session ->
            val command = session.exec(scriptFor(target, probe))
            command.join(CommandTimeoutSeconds, TimeUnit.SECONDS)
            val stdout = command.inputStream.readBytes().toString(StandardCharsets.UTF_8).trimEnd()
            val stderr = command.errorStream.readBytes().toString(StandardCharsets.UTF_8).trimEnd()
            val exitStatus = command.exitStatus ?: -1
            SshCommandResult(
                ok = exitStatus == 0,
                stdout = stdout,
                stderr = stderr,
                message = if (exitStatus == 0) "" else stderr.ifBlank { "exit $exitStatus" },
            )
        }
    }

    private fun <T> withAuthenticatedClient(
        target: RemoteTarget,
        secrets: SshConnectionSecrets,
        block: (SSHClient) -> T,
    ): T {
        try {
            SSHClient().use { client ->
                client.addHostKeyVerifier(capturingVerifier(expectedFingerprint = secrets.acceptedHostFingerprint))
                client.connect(target.host, target.port)
                val identityBytes = secrets.identityBytes ?: target.identityRefId?.let { identityStore?.loadProtectedBytesById(it) }
                if (identityBytes != null) {
                    client.authPublickey(target.user, keyProvider(identityBytes, secrets.passphrase))
                } else {
                    client.authPublickey(target.user)
                }
                return block(client)
            }
        } catch (err: SshClientException) {
            throw err
        } catch (err: Throwable) {
            throw SshClientException(classifyThrowable(err), err.message ?: "SSH command failed", err)
        }
    }

    private fun keyProvider(identityBytes: ByteArray, passphrase: CharArray?): OpenSSHKeyFile {
        val keyFile = OpenSSHKeyFile()
        val reader = StringReader(identityBytes.toString(StandardCharsets.UTF_8))
        keyFile.init(reader, null as Reader?, StaticPasswordFinder(passphrase))
        return keyFile
    }

    private fun capturingVerifier(
        expectedFingerprint: String? = null,
        onFingerprint: (String) -> Unit = {},
    ): HostKeyVerifier =
        object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: java.security.PublicKey): Boolean {
                val fingerprint = SecurityUtils.getFingerprint(key)
                onFingerprint(fingerprint)
                return expectedFingerprint == null || expectedFingerprint == fingerprint
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
        }

    private fun scriptFor(target: RemoteTarget, probe: SshDiagnosticProbe): String = when (probe) {
        SshDiagnosticProbe.CheckShell -> "printf '%s\\n' ok"
        SshDiagnosticProbe.CheckGit -> "command -v git"
        SshDiagnosticProbe.TestPath -> "test -d ${shellQuote(target.remotePath)}"
        SshDiagnosticProbe.RevParseTopLevel -> "git -C ${shellQuote(target.remotePath)} rev-parse --show-toplevel"
    }

    private fun shellQuote(value: String): String = "'${value.replace("'", "'\\''")}'"

    private fun classifyThrowable(err: Throwable): DiagnosticCategory {
        val text = "${err.message} ${err.cause?.message}".lowercase()
        return when {
            "permission denied" in text || "auth" in text -> DiagnosticCategory.AuthFailed
            "timed out" in text || "timeout" in text -> DiagnosticCategory.Timeout
            "host" in text && "key" in text -> DiagnosticCategory.HostKey
            "refused" in text || "unreachable" in text || "unknownhost" in text -> DiagnosticCategory.Unreachable
            else -> DiagnosticCategory.Unknown
        }
    }

    private class StaticPasswordFinder(private val value: CharArray?) : PasswordFinder {
        override fun reqPassword(resource: Resource<*>?): CharArray = value ?: CharArray(0)
        override fun shouldRetry(resource: Resource<*>?): Boolean = false
    }

    companion object {
        private const val CommandTimeoutSeconds = 15L
    }
}
