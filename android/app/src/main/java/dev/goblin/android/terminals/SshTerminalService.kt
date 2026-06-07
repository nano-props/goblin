package dev.goblin.android.terminals

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.ssh.SshConnectionSecrets
import dev.goblin.android.ssh.SshPublicKeyEncoding
import dev.goblin.android.ssh.SshjClients
import dev.goblin.android.ssh.SshPrivateKeys
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import net.schmizz.sshj.SSHClient
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
        onOutput: (ByteArray) -> Unit,
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
        val terminalSession = SshTerminalSession(
            id = UUID.randomUUID().toString(),
            client = client,
            sshSession = sshSession,
            shell = shell,
            onExit = onExit,
            onFailure = onFailure,
        )
        terminalSession.startReader(onOutput)
        terminalSession.scheduleStartupInput(
            input = SshTerminalStartupCommand.initialInputForRemotePath(target.remotePath),
            onOutput = onOutput,
        )
        return terminalSession
    }

    private fun capturingVerifier(target: RemoteTarget, expectedFingerprint: String?): HostKeyVerifier =
        object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: java.security.PublicKey): Boolean {
                val fingerprint = SshPublicKeyEncoding.fingerprint(key)
                return TerminalHostKeyPolicy.accepts(
                    target = target,
                    fingerprint = fingerprint,
                    explicitFingerprint = expectedFingerprint,
                    trustStore = hostKeyTrustStore,
                )
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
        }

}

internal object SshTerminalStartupCommand {
    const val InputDelayMillis = 150L

    fun initialInputForRemotePath(remotePath: String): String? {
        val normalizedPath = remotePath.trim().ifEmpty { "/" }
        if (normalizedPath == "/") return null
        return "cd ${shellQuote(normalizedPath)} && pwd\r"
    }

    fun startupInputFailureOutput(error: Throwable): String =
        "\r\nStartup cd failed: ${error.toTerminalDetail()}\r\n"

    private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"

    private fun Throwable.toTerminalDetail(): String {
        val message = message?.trim()?.takeIf { it.isNotBlank() }
        val className = this::class.java.simpleName.takeIf { it.isNotBlank() }
            ?: this::class.java.name
        return message ?: className
    }
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

    fun startReader(onOutput: (ByteArray) -> Unit) {
        thread(name = "goblin-ssh-terminal-$id", isDaemon = true) {
            runCatching {
                val buffer = ByteArray(4096)
                while (open.get()) {
                    val count = shell.inputStream.read(buffer)
                    if (count < 0) break
                    if (count > 0) onOutput(buffer.copyOf(count))
                }
            }.onFailure {
                if (open.get()) onFailure(it)
            }
            if (open.getAndSet(false)) onExit()
        }
    }

    fun scheduleStartupInput(input: String?, onOutput: (ByteArray) -> Unit) {
        if (input == null) return
        thread(name = "goblin-ssh-terminal-startup-$id", isDaemon = true) {
            runCatching {
                Thread.sleep(SshTerminalStartupCommand.InputDelayMillis)
                if (!open.get()) return@thread
                sendInputBytes(input.toByteArray(StandardCharsets.UTF_8))
            }.onFailure {
                if (open.get()) {
                    onOutput(SshTerminalStartupCommand.startupInputFailureOutput(it).toByteArray(StandardCharsets.UTF_8))
                }
            }
        }
    }

    override fun sendInputBytes(value: ByteArray) {
        shell.outputStream.write(value)
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
