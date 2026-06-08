package dev.goblin.android.domain.ssh

import java.util.UUID

data class RemoteRepositoryProfile(
    val id: String,
    val hostProfileId: String,
    val alias: String?,
    val remotePath: String,
) {
    val title: String = alias?.takeIf { it.isNotBlank() } ?: remotePath

    init {
        require(id.isNotBlank()) { "Remote repository id is required" }
        require(hostProfileId.isNotBlank()) { "Host profile id is required" }
        require(remotePath.startsWith("/")) { "Remote path must be absolute" }
    }

    companion object {
        fun create(
            hostProfileId: String,
            alias: String?,
            remotePath: String,
        ): RemoteRepositoryProfile {
            val normalizedHostProfileId = hostProfileId.trim()
            val normalizedAlias = alias?.trim()?.takeIf { it.isNotEmpty() }
            val normalizedRemotePath = remotePath.trim()
            require(normalizedHostProfileId.isNotEmpty()) { "Host profile id is required" }
            require(normalizedRemotePath.startsWith("/")) { "Remote path must be absolute" }
            return RemoteRepositoryProfile(
                id = UUID.randomUUID().toString(),
                hostProfileId = normalizedHostProfileId,
                alias = normalizedAlias,
                remotePath = normalizedRemotePath,
            )
        }
    }
}
