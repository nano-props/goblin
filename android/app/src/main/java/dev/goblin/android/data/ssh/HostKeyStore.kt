package dev.goblin.android.data.ssh

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget

interface HostKeyTrustStore {
    fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust
    fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted
}

class HostKeyStore private constructor(
    private val preferences: SharedPreferences,
) : HostKeyTrustStore {
    override fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust {
        val key = keyFor(target)
        return HostKeyTrustPolicy.evaluate(preferences.getString(key, null), fingerprint)
    }

    override fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted {
        preferences.edit { putString(keyFor(target), fingerprint) }
        return HostKeyTrust.Trusted(fingerprint)
    }

    fun reject(fingerprint: String): HostKeyTrust.Rejected = HostKeyTrust.Rejected(fingerprint)

    private fun keyFor(target: RemoteTarget): String = "host-key:${target.user}@${target.host}:${target.port}"

    companion object {
        private const val PreferencesName = "goblin-host-key-trust"

        fun create(context: Context): HostKeyStore =
            HostKeyStore(context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE))
    }
}

object HostKeyTrustPolicy {
    fun evaluate(trustedFingerprint: String?, currentFingerprint: String): HostKeyTrust = when {
        trustedFingerprint == null -> HostKeyTrust.Unknown
        trustedFingerprint == currentFingerprint -> HostKeyTrust.Trusted(currentFingerprint)
        else -> HostKeyTrust.Changed(
            previousFingerprint = trustedFingerprint,
            currentFingerprint = currentFingerprint,
        )
    }
}
