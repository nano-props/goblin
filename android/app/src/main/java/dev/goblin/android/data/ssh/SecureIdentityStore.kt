package dev.goblin.android.data.ssh

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dev.goblin.android.domain.ssh.SshIdentityRef
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SshIdentityMaterialStore {
    fun importPrivateKey(displayName: String, keyBytes: ByteArray): SshIdentityRef
    fun loadProtectedBytesById(identityId: String): ByteArray
}

class SecureIdentityStore private constructor(
    private val filesDir: File,
) : SshIdentityMaterialStore {
    override fun importPrivateKey(displayName: String, keyBytes: ByteArray): SshIdentityRef {
        require(keyBytes.isNotEmpty()) { "Identity data is required" }
        val id = UUID.randomUUID().toString()
        val encrypted = encrypt(keyBytes)
        val target = File(filesDir, "$id.identity")
        target.writeText(encrypted.serialize())
        return SshIdentityRef(
            id = id,
            displayName = displayName.ifBlank { "SSH identity" },
            protectedPath = target.absolutePath,
            importedAtMillis = System.currentTimeMillis(),
        )
    }

    fun loadProtectedBytes(identityRef: SshIdentityRef): ByteArray {
        val record = EncryptedIdentityRecord.deserialize(File(identityRef.protectedPath).readText())
        return decrypt(record)
    }

    override fun loadProtectedBytesById(identityId: String): ByteArray {
        val record = EncryptedIdentityRecord.deserialize(File(filesDir, "$identityId.identity").readText())
        return decrypt(record)
    }

    private fun encrypt(value: ByteArray): EncryptedIdentityRecord {
        val cipher = Cipher.getInstance(Transformation)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        return EncryptedIdentityRecord(
            ivBase64 = Base64.getEncoder().encodeToString(cipher.iv),
            encryptedPayloadBase64 = Base64.getEncoder().encodeToString(cipher.doFinal(value)),
        )
    }

    private fun decrypt(record: EncryptedIdentityRecord): ByteArray {
        val cipher = Cipher.getInstance(Transformation)
        val iv = Base64.getDecoder().decode(record.ivBase64)
        val payload = Base64.getDecoder().decode(record.encryptedPayloadBase64)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GcmTagLengthBits, iv))
        return cipher.doFinal(payload)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(AndroidKeyStore)
        keyStore.load(null)
        (keyStore.getKey(KeyAlias, null) as? SecretKey)?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, AndroidKeyStore)
        keyGenerator.init(
            KeyGenParameterSpec.Builder(KeyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return keyGenerator.generateKey()
    }

    companion object {
        private const val AndroidKeyStore = "AndroidKeyStore"
        private const val KeyAlias = "goblin-ssh-identity"
        private const val Transformation = "AES/GCM/NoPadding"
        private const val GcmTagLengthBits = 128

        fun create(context: Context): SecureIdentityStore =
            SecureIdentityStore(File(context.filesDir, "ssh-identities").apply { mkdirs() })
    }
}

data class EncryptedIdentityRecord(
    val ivBase64: String,
    val encryptedPayloadBase64: String,
) {
    fun serialize(): String = "$ivBase64:$encryptedPayloadBase64"

    companion object {
        fun deserialize(value: String): EncryptedIdentityRecord {
            val parts = value.split(":", limit = 2)
            require(parts.size == 2) { "Invalid identity record" }
            return EncryptedIdentityRecord(ivBase64 = parts[0], encryptedPayloadBase64 = parts[1])
        }
    }
}
