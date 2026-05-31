package dev.goblin.android.domain.ssh

sealed interface HostKeyTrust {
    data object Unknown : HostKeyTrust
    data class Trusted(val fingerprint: String) : HostKeyTrust
    data class Changed(val previousFingerprint: String, val currentFingerprint: String) : HostKeyTrust
    data class Rejected(val fingerprint: String) : HostKeyTrust
}

