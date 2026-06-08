package dev.goblin.android.ssh

import java.security.Key
import java.security.PrivateKey
import java.security.PublicKey
import java.util.Base64
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.userauth.keyprovider.KeyProvider

internal object SshKeyCompatibility {
    private const val Ed25519Algorithm = "Ed25519"
    private const val Ed25519KeyBytes = 32
    private val Ed25519PublicKeyHeader = Base64.getDecoder().decode("MCowBQYDK2VwAyEA")
    private val Ed25519PrivateKeyHeader = Base64.getDecoder().decode("MC4CAQEwBQYDK2VwBCIEIA")

    fun publicKeyForSshj(publicKey: PublicKey): PublicKey =
        if (KeyType.fromKey(publicKey) == KeyType.UNKNOWN && publicKey.isEncodedEd25519PublicKey()) {
            Ed25519PublicKey(publicKey)
        } else {
            publicKey
        }

    fun privateKeyForSshj(privateKey: PrivateKey): PrivateKey =
        if (KeyType.fromKey(privateKey) == KeyType.UNKNOWN && privateKey.isEncodedEd25519PrivateKey()) {
            Ed25519PrivateKey(privateKey)
        } else {
            privateKey
        }

    fun keyProviderForSshj(delegate: KeyProvider): KeyProvider =
        object : KeyProvider {
            override fun getPrivate(): PrivateKey = privateKeyForSshj(delegate.private)
            override fun getPublic(): PublicKey = publicKeyForSshj(delegate.public)
            override fun getType(): KeyType = KeyType.fromKey(public)
            override fun toString(): String = delegate.toString()
        }

    fun publicKeyBlob(publicKey: PublicKey): ByteArray =
        Buffer.PlainBuffer()
            .putPublicKey(publicKeyForSshj(publicKey))
            .compactData

    private fun Key.isEncodedEd25519PublicKey(): Boolean =
        encodedOrNull()?.hasDerPrefix(Ed25519PublicKeyHeader) == true

    private fun Key.isEncodedEd25519PrivateKey(): Boolean =
        encodedOrNull()?.hasDerPrefix(Ed25519PrivateKeyHeader) == true

    private fun Key.encodedOrNull(): ByteArray? =
        runCatching { encoded }.getOrNull()

    private fun ByteArray.hasDerPrefix(prefix: ByteArray): Boolean =
        size >= prefix.size + Ed25519KeyBytes && prefix.indices.all { this[it] == prefix[it] }

    private class Ed25519PublicKey(private val delegate: PublicKey) : PublicKey {
        override fun getAlgorithm(): String = Ed25519Algorithm
        override fun getFormat(): String = delegate.format
        override fun getEncoded(): ByteArray = delegate.encoded.clone()
        override fun toString(): String = delegate.toString()
    }

    private class Ed25519PrivateKey(private val delegate: PrivateKey) : PrivateKey {
        override fun getAlgorithm(): String = Ed25519Algorithm
        override fun getFormat(): String = delegate.format
        override fun getEncoded(): ByteArray = delegate.encoded.clone()
        override fun toString(): String = delegate.toString()
    }
}
