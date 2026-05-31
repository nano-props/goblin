package dev.goblin.android.domain.ssh

import java.util.UUID

data class PortForwardRequest(
    val remoteHost: String,
    val remotePort: Int,
    val localHost: String,
    val localPort: Int,
) {
    init {
        require(remoteHost.isNotBlank()) { "Remote host is required" }
        require(remotePort in SshHostProfile.ValidPortRange) { "Remote port must be in 1..65535" }
        require(localHost == LoopbackHost) { "Local host must be 127.0.0.1" }
        require(localPort == AutoLocalPort || localPort in SshHostProfile.ValidPortRange) {
            "Local port must be 0 or in 1..65535"
        }
    }

    companion object {
        const val LoopbackHost = "127.0.0.1"
        const val AutoLocalPort = 0

        fun create(
            remoteHost: String = LoopbackHost,
            remotePort: Int,
            localPort: Int = AutoLocalPort,
        ): PortForwardRequest = PortForwardRequest(
            remoteHost = remoteHost.trim(),
            remotePort = remotePort,
            localHost = LoopbackHost,
            localPort = localPort,
        )

        fun fromInput(
            remotePort: String,
            localPort: String,
            remoteHost: String = LoopbackHost,
        ): PortForwardRequest {
            val parsedRemotePort = remotePort.trim().toIntOrNull()
                ?: throw IllegalArgumentException("Remote port must be a number")
            val parsedLocalPort = localPort.trim()
                .takeIf { it.isNotEmpty() }
                ?.let {
                    val port = it.toIntOrNull() ?: throw IllegalArgumentException("Local port must be a number")
                    require(port in SshHostProfile.ValidPortRange) { "Local port must be in 1..65535" }
                    port
                }
                ?: AutoLocalPort
            return create(
                remoteHost = remoteHost,
                remotePort = parsedRemotePort,
                localPort = parsedLocalPort,
            )
        }
    }
}

data class PortForwardOwner(
    val id: String,
    val label: String,
) {
    init {
        require(id.isNotBlank()) { "Port forward owner id is required" }
        require(label.isNotBlank()) { "Port forward owner label is required" }
    }
}

enum class PortForwardSessionStatus {
    Starting,
    Active,
    Stopped,
    Failed,
}

data class PortForwardSession(
    val id: String,
    val owner: PortForwardOwner,
    val request: PortForwardRequest,
    val status: PortForwardSessionStatus,
    val localPort: Int? = null,
    val message: String? = null,
) {
    val localUrl: String? = localPort?.let { forwardedLocalUrl(it) }

    companion object {
        fun starting(owner: PortForwardOwner, request: PortForwardRequest): PortForwardSession =
            PortForwardSession(
                id = UUID.randomUUID().toString(),
                owner = owner,
                request = request,
                status = PortForwardSessionStatus.Starting,
            )
    }
}

fun forwardedLocalUrl(localPort: Int): String {
    require(localPort in SshHostProfile.ValidPortRange) { "Local port must be in 1..65535" }
    return "http://${PortForwardRequest.LoopbackHost}:$localPort"
}

fun canCreatePortForward(remotePort: String, localPort: String): Boolean =
    runCatching {
        val parsedRemotePort = remotePort.trim().toIntOrNull() ?: return false
        val localPortInput = localPort.trim()
        val parsedLocalPort = if (localPortInput.isEmpty()) {
            PortForwardRequest.AutoLocalPort
        } else {
            localPortInput.toIntOrNull() ?: return false
        }
        parsedRemotePort in SshHostProfile.ValidPortRange &&
            (localPortInput.isEmpty() || parsedLocalPort in SshHostProfile.ValidPortRange)
    }.getOrDefault(false)
