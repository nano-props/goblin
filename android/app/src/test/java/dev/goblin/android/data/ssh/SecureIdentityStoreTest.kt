package dev.goblin.android.data.ssh

import dev.goblin.android.data.HostProfileCodec
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.domain.ssh.SshIdentityRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecureIdentityStoreTest {
    @Test
    fun `identity metadata stores a reference without raw key text`() {
        val identity = SshIdentityRef(
            id = "identity-1",
            displayName = "id_ed25519",
            protectedPath = "/app/ssh-identities/identity-1.identity",
            importedAtMillis = 1L,
        )
        val host = SshHostProfile.create(
            alias = "Dev",
            host = "example.com",
            user = "lee",
            identityRefId = identity.id,
        )

        val payload = HostProfileCodec.encode(listOf(host))

        assertEquals(identity.id, HostProfileCodec.decode(payload).single().identityRefId)
        assertFalse(payload.contains("OPENSSH"))
        assertFalse(payload.contains("raw key bytes"))
    }

    @Test
    fun `encrypted identity record round trips as protected payload`() {
        val record = EncryptedIdentityRecord(ivBase64 = "iv", encryptedPayloadBase64 = "payload")

        assertEquals(record, EncryptedIdentityRecord.deserialize(record.serialize()))
    }

    @Test
    fun `host profile serialization rejects secret field names`() {
        val payload = HostProfileCodec.encode(
            listOf(SshHostProfile.create(alias = "Dev", host = "example.com", user = "lee", identityRefId = "id-1")),
        )

        assertFalse(payload.contains("password", ignoreCase = true))
        assertFalse(payload.contains("passphrase", ignoreCase = true))
        assertFalse(payload.contains("privateKey", ignoreCase = true))
        assertFalse(payload.contains("rawKey", ignoreCase = true))
        assertTrue(payload.isNotBlank())
    }
}

