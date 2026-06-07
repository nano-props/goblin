package dev.goblin.android.ssh

import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.util.Base64
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class SshPublicKeyEncodingTest {
    @Test
    fun `public key line accepts ed25519 keys with provider specific algorithm names`() {
        val key = ProviderSpecificPublicKey(Ed25519PublicKeyDer + RawPublicKey)

        val line = SshPublicKeyEncoding.publicKeyLine(key, "imported")

        assertEquals(
            "ssh-ed25519 ${Base64.getEncoder().encodeToString(sshEd25519Blob(RawPublicKey))} imported",
            line,
        )
    }

    @Test
    fun `fingerprint accepts ed25519 keys with provider specific algorithm names`() {
        val key = ProviderSpecificPublicKey(Ed25519PublicKeyDer + RawPublicKey)

        val fingerprint = SshPublicKeyEncoding.fingerprint(key)

        assertEquals(md5Fingerprint(sshEd25519Blob(RawPublicKey)), fingerprint)
    }

    @Test
    fun `compatibility wrappers make provider specific ed25519 keys visible to sshj`() {
        val publicKey = ProviderSpecificPublicKey(Ed25519PublicKeyDer + RawPublicKey)
        val privateKey = ProviderSpecificPrivateKey(Ed25519PrivateKeyDer + RawPrivateKey)

        val sshjPublicKey = SshKeyCompatibility.publicKeyForSshj(publicKey)
        val sshjPrivateKey = SshKeyCompatibility.privateKeyForSshj(privateKey)

        assertEquals(KeyType.ED25519, KeyType.fromKey(sshjPublicKey))
        assertEquals(KeyType.ED25519, KeyType.fromKey(sshjPrivateKey))
        assertArrayEquals(
            sshEd25519Blob(RawPublicKey),
            Buffer.PlainBuffer().putPublicKey(sshjPublicKey).compactData,
        )
    }

    private class ProviderSpecificPublicKey(private val encoded: ByteArray) : PublicKey {
        override fun getAlgorithm(): String = "1.3.101.112"
        override fun getFormat(): String = "X.509"
        override fun getEncoded(): ByteArray = encoded.clone()
    }

    private class ProviderSpecificPrivateKey(private val encoded: ByteArray) : PrivateKey {
        override fun getAlgorithm(): String = "1.3.101.112"
        override fun getFormat(): String = "PKCS#8"
        override fun getEncoded(): ByteArray = encoded.clone()
    }

    private companion object {
        val Ed25519PublicKeyDer: ByteArray = Base64.getDecoder().decode("MCowBQYDK2VwAyEA")
        val Ed25519PrivateKeyDer: ByteArray = Base64.getDecoder().decode("MC4CAQEwBQYDK2VwBCIEIA")
        val RawPublicKey: ByteArray = ByteArray(32) { (it + 1).toByte() }
        val RawPrivateKey: ByteArray = ByteArray(32) { (it + 33).toByte() }

        fun sshEd25519Blob(rawKey: ByteArray): ByteArray =
            Buffer.PlainBuffer()
                .putString("ssh-ed25519")
                .putBytes(rawKey)
                .compactData

        fun md5Fingerprint(bytes: ByteArray): String =
            MessageDigest.getInstance("MD5")
                .digest(bytes)
                .joinToString(":") { byte ->
                    (byte.toInt() and 0xff).toString(16).padStart(2, '0')
                }
    }
}
