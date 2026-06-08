package dev.goblin.android.domain.ssh

import java.util.UUID

data class SshHostProfile(
    val id: String,
    val alias: String?,
    val host: String,
    val user: String,
    val port: Int,
    val identityRefId: String? = null,
    val lastDiagnosticStatus: String? = null,
) {
    val title: String = alias?.takeIf { it.isNotBlank() } ?: "$user@$host"
    val subtitle: String = "$user@$host:$port"

    init {
        require(id.isNotBlank()) { "Host profile id is required" }
        require(host.isNotBlank()) { "Host is required" }
        require(user.isNotBlank()) { "User is required" }
        require(port in ValidPortRange) { "Port must be in 1..65535" }
    }

    companion object {
        val ValidPortRange: IntRange = 1..65535

        fun create(
            alias: String?,
            host: String,
            user: String,
            port: Int? = null,
            identityRefId: String? = null,
        ): SshHostProfile {
            val normalizedHost = host.trim()
            val normalizedUser = user.trim()
            val normalizedAlias = alias?.trim()?.takeIf { it.isNotEmpty() }
            val normalizedPort = port ?: 22
            require(normalizedHost.isNotEmpty()) { "Host is required" }
            require(normalizedUser.isNotEmpty()) { "User is required" }
            require(normalizedPort in ValidPortRange) { "Port must be in 1..65535" }
            return SshHostProfile(
                id = UUID.randomUUID().toString(),
                alias = normalizedAlias,
                host = normalizedHost,
                user = normalizedUser,
                port = normalizedPort,
                identityRefId = identityRefId?.trim()?.takeIf { it.isNotEmpty() },
            )
        }

        fun update(
            existing: SshHostProfile,
            alias: String?,
            host: String,
            user: String,
            port: Int,
            identityRefId: String? = existing.identityRefId,
        ): SshHostProfile {
            val normalizedHost = host.trim()
            val normalizedUser = user.trim()
            val normalizedAlias = alias?.trim()?.takeIf { it.isNotEmpty() }
            require(normalizedHost.isNotEmpty()) { "Host is required" }
            require(normalizedUser.isNotEmpty()) { "User is required" }
            require(port in ValidPortRange) { "Port must be in 1..65535" }
            return existing.copy(
                alias = normalizedAlias,
                host = normalizedHost,
                user = normalizedUser,
                port = port,
                identityRefId = identityRefId?.trim()?.takeIf { it.isNotEmpty() },
            )
        }

        fun parsePort(value: String): Int {
            val trimmed = value.trim()
            if (trimmed.isEmpty()) return 22
            val port = trimmed.toIntOrNull() ?: throw IllegalArgumentException("Port must be a number")
            require(port in ValidPortRange) { "Port must be in 1..65535" }
            return port
        }
    }
}
