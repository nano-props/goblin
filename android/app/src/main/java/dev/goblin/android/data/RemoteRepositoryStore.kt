package dev.goblin.android.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import java.nio.charset.StandardCharsets
import java.util.Base64

class RemoteRepositoryStore private constructor(
    private val preferences: SharedPreferences,
) {
    fun loadRepositories(): List<RemoteRepositoryProfile> =
        RemoteRepositoryCodec.decode(preferences.getString(KeyRepositories, "").orEmpty())

    fun saveRepository(repository: RemoteRepositoryProfile): RemoteRepositoryProfile {
        val next = RemoteRepositoryStorePolicy.upsertRepository(loadRepositories(), repository)
        preferences.edit { putString(KeyRepositories, RemoteRepositoryCodec.encode(next)) }
        return repository
    }

    fun deleteRepository(repositoryId: String) {
        val next = RemoteRepositoryStorePolicy.deleteRepository(loadRepositories(), repositoryId)
        preferences.edit { putString(KeyRepositories, RemoteRepositoryCodec.encode(next)) }
    }

    fun deleteByHostId(hostProfileId: String) {
        val next = RemoteRepositoryStorePolicy.deleteByHostId(loadRepositories(), hostProfileId)
        preferences.edit { putString(KeyRepositories, RemoteRepositoryCodec.encode(next)) }
    }

    companion object {
        private const val PreferencesName = "goblin-remote-repositories"
        private const val KeyRepositories = "repositories"

        fun create(context: Context): RemoteRepositoryStore =
            RemoteRepositoryStore(context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE))
    }
}

object RemoteRepositoryStorePolicy {
    fun upsertRepository(
        repositories: List<RemoteRepositoryProfile>,
        repository: RemoteRepositoryProfile,
    ): List<RemoteRepositoryProfile> = repositories.filterNot { it.id == repository.id } + repository

    fun deleteRepository(
        repositories: List<RemoteRepositoryProfile>,
        repositoryId: String,
    ): List<RemoteRepositoryProfile> = repositories.filterNot { it.id == repositoryId }

    fun deleteByHostId(
        repositories: List<RemoteRepositoryProfile>,
        hostProfileId: String,
    ): List<RemoteRepositoryProfile> = repositories.filterNot { it.hostProfileId == hostProfileId }
}

object RemoteRepositoryCodec {
    private const val FieldSeparator = "."
    private const val RecordSeparator = "\n"

    fun encode(repositories: List<RemoteRepositoryProfile>): String =
        repositories.joinToString(RecordSeparator) { repository ->
            listOf(
                repository.id,
                repository.hostProfileId,
                repository.alias.orEmpty(),
                repository.remotePath,
            ).joinToString(FieldSeparator) { it.encodeField() }
        }

    fun decode(payload: String): List<RemoteRepositoryProfile> {
        if (payload.isBlank()) return emptyList()
        return payload.lineSequence()
            .filter { it.isNotBlank() }
            .mapNotNull(::decodeRepository)
            .toList()
    }

    private fun decodeRepository(line: String): RemoteRepositoryProfile? {
        val fields = line.split(FieldSeparator).map { it.decodeField() }
        if (fields.size != 4) return null
        return runCatching {
            RemoteRepositoryProfile(
                id = fields[0],
                hostProfileId = fields[1],
                alias = fields[2].takeIf { it.isNotBlank() },
                remotePath = fields[3],
            )
        }.getOrNull()
    }

    private fun String.encodeField(): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(toByteArray(StandardCharsets.UTF_8))

    private fun String.decodeField(): String =
        String(Base64.getUrlDecoder().decode(this), StandardCharsets.UTF_8)
}
