package dev.goblin.android.domain.ssh

data class RemoteTarget(
    val id: String,
    val alias: String?,
    val host: String,
    val user: String,
    val port: Int,
    val remotePath: String,
    val identityRefId: String?,
) {
    val authority: String = "$user@$host:$port"

    companion object {
        fun fromHostProfile(profile: SshHostProfile, remotePath: String = "/"): RemoteTarget {
            val normalizedPath = remotePath.trim().ifEmpty { "/" }
            return RemoteTarget(
                id = "${profile.user}@${profile.host}:${profile.port}$normalizedPath",
                alias = profile.alias,
                host = profile.host,
                user = profile.user,
                port = profile.port,
                remotePath = normalizedPath,
                identityRefId = profile.identityRefId,
            )
        }
    }
}

