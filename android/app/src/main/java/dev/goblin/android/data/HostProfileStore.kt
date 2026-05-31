package dev.goblin.android.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.goblin.android.domain.ssh.SshHostProfile
import java.nio.charset.StandardCharsets
import java.util.Base64

class HostProfileStore private constructor(
    private val preferences: SharedPreferences,
) {
    fun loadHosts(): List<SshHostProfile> = HostProfileCodec.decode(preferences.getString(KeyHosts, "").orEmpty())

    fun saveHost(hostProfile: SshHostProfile): SshHostProfile {
        val current = loadHosts()
        val next = current.filterNot { it.id == hostProfile.id } + hostProfile
        preferences.edit { putString(KeyHosts, HostProfileCodec.encode(next)) }
        return hostProfile
    }

    companion object {
        private const val PreferencesName = "goblin-host-profiles"
        private const val KeyHosts = "hosts"

        fun create(context: Context): HostProfileStore =
            HostProfileStore(context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE))
    }
}

object HostProfileCodec {
    private const val FieldSeparator = "."
    private const val RecordSeparator = "\n"

    fun encode(hosts: List<SshHostProfile>): String = hosts.joinToString(RecordSeparator) { host ->
        listOf(
            host.id,
            host.alias.orEmpty(),
            host.host,
            host.user,
            host.port.toString(),
            host.identityRefId.orEmpty(),
            host.lastDiagnosticStatus.orEmpty(),
        ).joinToString(FieldSeparator) { it.encodeField() }
    }

    fun decode(payload: String): List<SshHostProfile> {
        if (payload.isBlank()) return emptyList()
        return payload.lineSequence()
            .filter { it.isNotBlank() }
            .mapNotNull(::decodeHost)
            .toList()
    }

    private fun decodeHost(line: String): SshHostProfile? {
        val fields = line.split(FieldSeparator).map { it.decodeField() }
        if (fields.size != 7) return null
        val port = fields[4].toIntOrNull() ?: return null
        return runCatching {
            SshHostProfile(
                id = fields[0],
                alias = fields[1].takeIf { it.isNotBlank() },
                host = fields[2],
                user = fields[3],
                port = port,
                identityRefId = fields[5].takeIf { it.isNotBlank() },
                lastDiagnosticStatus = fields[6].takeIf { it.isNotBlank() },
            )
        }.getOrNull()
    }

    private fun String.encodeField(): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(toByteArray(StandardCharsets.UTF_8))

    private fun String.decodeField(): String =
        String(Base64.getUrlDecoder().decode(this), StandardCharsets.UTF_8)
}
