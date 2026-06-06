package dev.goblin.android.terminals

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import dev.goblin.android.ssh.SshjClients
import dev.goblin.android.ssh.SshPrivateKeys
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.PTYMode
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.verification.HostKeyVerifier

class SshTerminalService(
    private val identityStore: SecureIdentityStore? = null,
    private val hostKeyTrustStore: HostKeyTrustStore? = null,
    private val keepAliveIntervalSeconds: () -> Long = { TerminalHeartbeatIntervalSeconds },
) : TerminalSessionFactory {
    // Shares the same SSHJ boundary and trust expectations as SshClientFacade.kt.
    override fun openShell(
        target: RemoteTarget,
        secrets: SshConnectionSecrets,
        cols: Int,
        rows: Int,
        onOutput: (String) -> Unit,
        onExit: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ): TerminalSession {
        val client = SshjClients.create()
        val interval = keepAliveIntervalSeconds()
            .coerceIn(MinTerminalHeartbeatIntervalSeconds..MaxTerminalHeartbeatIntervalSeconds)
        client.getConnection().getKeepAlive().setKeepAliveInterval(interval.toInt())
        client.addHostKeyVerifier(capturingVerifier(target, secrets.acceptedHostFingerprint))
        client.connect(target.host, target.port)
        val identityBytes = secrets.identityBytes ?: target.identityRefId?.let { identityStore?.loadProtectedBytesById(it) }
        if (identityBytes != null) {
            client.authPublickey(target.user, SshPrivateKeys.keyProvider(client, identityBytes, secrets.passphrase))
        } else {
            client.authPublickey(target.user)
        }

        val sshSession = client.startSession()
        sshSession.allocatePTY("xterm-256color", cols, rows, 0, 0, emptyMap<PTYMode, Int>())
        val shell = sshSession.startShell()
        writeInitialDirectory(shell, target.remotePath)
        val terminalSession = SshTerminalSession(
            id = UUID.randomUUID().toString(),
            client = client,
            sshSession = sshSession,
            shell = shell,
            onExit = onExit,
            onFailure = onFailure,
        )
        terminalSession.startReader(onOutput)
        return terminalSession
    }

    private fun capturingVerifier(target: RemoteTarget, expectedFingerprint: String?): HostKeyVerifier =
        object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: java.security.PublicKey): Boolean {
                val fingerprint = SecurityUtils.getFingerprint(key)
                return TerminalHostKeyPolicy.accepts(
                    target = target,
                    fingerprint = fingerprint,
                    explicitFingerprint = expectedFingerprint,
                    trustStore = hostKeyTrustStore,
                )
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
        }

    private fun writeInitialDirectory(shell: Session.Shell, remotePath: String) {
        val normalizedPath = remotePath.trim().ifEmpty { "/" }
        if (normalizedPath == "/") return
        shell.outputStream.write("cd ${shellQuote(normalizedPath)}\n".toByteArray(StandardCharsets.UTF_8))
        shell.outputStream.flush()
    }

    private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"
}

internal object TerminalHostKeyPolicy {
    fun accepts(
        target: RemoteTarget,
        fingerprint: String,
        explicitFingerprint: String?,
        trustStore: HostKeyTrustStore?,
    ): Boolean {
        if (explicitFingerprint != null) return explicitFingerprint == fingerprint
        return trustStore?.evaluate(target, fingerprint) is HostKeyTrust.Trusted
    }
}

private class SshTerminalSession(
    override val id: String,
    private val client: SSHClient,
    private val sshSession: Session,
    private val shell: Session.Shell,
    private val onExit: () -> Unit,
    private val onFailure: (Throwable) -> Unit,
) : TerminalSession {
    private val open = AtomicBoolean(true)

    override fun isConnected(): Boolean = runCatching {
        open.get() && client.isConnected && sshSession.isOpen && shell.isOpen
    }.getOrDefault(false)

    fun startReader(onOutput: (String) -> Unit) {
        thread(name = "goblin-ssh-terminal-$id", isDaemon = true) {
            runCatching {
                val buffer = ByteArray(4096)
                while (open.get()) {
                    val count = shell.inputStream.read(buffer)
                    if (count < 0) break
                    if (count > 0) onOutput(String(buffer, 0, count, StandardCharsets.UTF_8))
                }
            }.onFailure {
                if (open.get()) onFailure(it)
            }
            if (open.getAndSet(false)) onExit()
        }
    }

    override fun sendInput(value: String) {
        shell.outputStream.write(value.toByteArray(StandardCharsets.UTF_8))
        shell.outputStream.flush()
    }

    override fun resize(cols: Int, rows: Int) {
        shell.changeWindowDimensions(cols, rows, 0, 0)
    }

    override fun close() {
        if (!open.getAndSet(false)) return
        runCatching { shell.close() }
        runCatching { sshSession.close() }
        runCatching { client.close() }
    }
}
