package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.data.ssh.SecureIdentityStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.PortForwardOwner
import dev.goblin.android.domain.ssh.PortForwardRequest
import dev.goblin.android.domain.ssh.PortForwardSession
import dev.goblin.android.domain.ssh.PortForwardSessionStatus
import dev.goblin.android.domain.ssh.RemoteTarget
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.security.PublicKey
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.LocalPortForwarder
import net.schmizz.sshj.connection.channel.direct.Parameters
import net.schmizz.sshj.transport.verification.HostKeyVerifier

interface ActivePortForward : AutoCloseable {
    val localPort: Int

    override fun close()
}

interface PortForwardBackend {
    fun open(target: RemoteTarget, request: PortForwardRequest): ActivePortForward
}

class PortForwardManager(
    private val backend: PortForwardBackend,
) {
    private val sessions = ConcurrentHashMap<String, PortForwardSession>()
    private val handles = ConcurrentHashMap<String, ActivePortForward>()

    fun sessions(ownerId: String? = null): List<PortForwardSession> =
        sessions.values
            .filter { ownerId == null || it.owner.id == ownerId }
            .sortedBy { it.id }

    fun start(
        owner: PortForwardOwner,
        target: RemoteTarget,
        request: PortForwardRequest,
    ): PortForwardSession {
        val starting = PortForwardSession.starting(owner, request)
        sessions[starting.id] = starting
        val active = runCatching {
            val handle = backend.open(target, request)
            handles[starting.id] = handle
            starting.copy(
                status = PortForwardSessionStatus.Active,
                localPort = handle.localPort,
            )
        }.getOrElse { err ->
            starting.copy(
                status = PortForwardSessionStatus.Failed,
                message = err.message ?: "Port forward failed",
            )
        }
        sessions[starting.id] = active
        return active
    }

    fun stop(sessionId: String): PortForwardSession? {
        val current = sessions[sessionId] ?: return null
        handles.remove(sessionId)?.close()
        val stopped = current.copy(status = PortForwardSessionStatus.Stopped)
        sessions[sessionId] = stopped
        return stopped
    }

    fun stopOwner(ownerId: String): List<PortForwardSession> =
        sessions.values
            .filter { it.owner.id == ownerId && it.status == PortForwardSessionStatus.Active }
            .mapNotNull { stop(it.id) }
}

class SshjPortForwardBackend(
    private val identityStore: SecureIdentityStore? = null,
    private val hostKeyTrustStore: HostKeyTrustStore? = null,
) : PortForwardBackend {
    override fun open(target: RemoteTarget, request: PortForwardRequest): ActivePortForward {
        val client = SshjClients.create()
        var serverSocket: ServerSocket? = null
        try {
            client.addHostKeyVerifier(portForwardHostKeyVerifier(target, hostKeyTrustStore))
            client.connect(target.host, target.port)
            val identityBytes = target.identityRefId?.let { identityStore?.loadProtectedBytesById(it) }
            if (identityBytes != null) {
                client.authPublickey(target.user, SshPrivateKeys.keyProvider(client, identityBytes, passphrase = null))
            } else {
                client.authPublickey(target.user)
            }

            serverSocket = ServerSocket()
            serverSocket.bind(InetSocketAddress(request.localHost, request.localPort))
            val assignedLocalPort = serverSocket.localPort
            val parameters = Parameters(
                request.localHost,
                assignedLocalPort,
                request.remoteHost,
                request.remotePort,
            )
            val forwarder = client.newLocalPortForwarder(parameters, serverSocket)
            val listener = thread(
                name = "goblin-port-forward-$assignedLocalPort",
                isDaemon = true,
            ) {
                runCatching { forwarder.listen(Thread.currentThread()) }
            }
            return SshjActivePortForward(
                client = client,
                serverSocket = serverSocket,
                forwarder = forwarder,
                listener = listener,
                localPort = assignedLocalPort,
            )
        } catch (err: Throwable) {
            runCatching { serverSocket?.close() }
            runCatching { client.close() }
            throw err
        }
    }
}

private class SshjActivePortForward(
    private val client: SSHClient,
    private val serverSocket: ServerSocket,
    private val forwarder: LocalPortForwarder,
    private val listener: Thread,
    override val localPort: Int,
) : ActivePortForward {
    override fun close() {
        if (forwarder.isRunning()) {
            runCatching { forwarder.close() }
        } else {
            runCatching { serverSocket.close() }
        }
        listener.interrupt()
        runCatching { client.close() }
    }
}

private fun portForwardHostKeyVerifier(
    target: RemoteTarget,
    trustStore: HostKeyTrustStore?,
): HostKeyVerifier =
    object : HostKeyVerifier {
        override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
            val fingerprint = SecurityUtils.getFingerprint(key)
            return trustStore?.evaluate(target, fingerprint) is HostKeyTrust.Trusted
        }

        override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
    }
