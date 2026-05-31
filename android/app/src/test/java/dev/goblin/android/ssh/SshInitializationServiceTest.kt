package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustPolicy
import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.data.ssh.SshIdentityMaterialStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.domain.ssh.SshIdentityRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SshInitializationServiceTest {
    @Test
    fun `check asks for host key trust before password installation`() {
        val service = service(trustedFingerprint = null, fingerprint = "SHA256:new")

        val check = service.check(profile())

        assertEquals(SshInitializationCheck.NeedsHostKeyTrust("SHA256:new"), check)
    }

    @Test
    fun `check asks for temporary server password when host key is trusted but no identity exists`() {
        val service = service(trustedFingerprint = "SHA256:new", fingerprint = "SHA256:new")

        val check = service.check(profile())

        assertEquals(SshInitializationCheck.NeedsServerPassword, check)
    }

    @Test
    fun `check is ready when host key is trusted and identity exists`() {
        val service = service(trustedFingerprint = "SHA256:new", fingerprint = "SHA256:new")

        val check = service.check(profile(identityRefId = "identity-1"))

        assertEquals(SshInitializationCheck.Ready, check)
    }

    @Test
    fun `changed host key blocks initialization`() {
        val service = service(trustedFingerprint = "SHA256:old", fingerprint = "SHA256:new")

        val check = service.check(profile())

        assertEquals(SshInitializationCheck.HostKeyChanged("SHA256:old", "SHA256:new"), check)
    }

    @Test
    fun `initialize generates app identity and installs its public key after host key trust`() {
        val identityStore = FakeIdentityStore()
        val client = FakeInitializationClient(fingerprint = "SHA256:new")
        val keyGenerator = FakeSshKeyGenerator()
        val password = "temporary-password".toCharArray()
        val service = service(
            identityStore = identityStore,
            client = client,
            keyGenerator = keyGenerator,
            trustedFingerprint = "SHA256:new",
            fingerprint = "SHA256:new",
        )

        val result = service.initialize(profile(), password)

        assertEquals("generated-identity", result.profile.identityRefId)
        assertEquals("ssh-ed25519 generated-public-key goblin-android", client.installedPublicKeys.single())
        assertEquals("temporary-password", client.passwords.single())
        assertTrue(password.all { it == '\u0000' })
        assertEquals(listOf("generated-private-key"), identityStore.importedPayloads)
    }

    @Test
    fun `initialize reuses existing identity and never stores the temporary password`() {
        val identityStore = FakeIdentityStore(existingBytesById = mapOf("identity-1" to "existing-private-key".toByteArray()))
        val client = FakeInitializationClient(fingerprint = "SHA256:new")
        val publicKeyReader = FakePublicKeyReader("ssh-ed25519 existing-public-key imported")
        val password = "secret".toCharArray()
        val service = service(
            identityStore = identityStore,
            client = client,
            publicKeyReader = publicKeyReader,
            trustedFingerprint = "SHA256:new",
            fingerprint = "SHA256:new",
        )

        val result = service.initialize(profile(identityRefId = "identity-1"), password)

        assertEquals("identity-1", result.profile.identityRefId)
        assertEquals(emptyList<String>(), identityStore.importedPayloads)
        assertEquals(listOf("ssh-ed25519 existing-public-key imported"), client.installedPublicKeys)
        assertEquals(listOf("existing-private-key"), publicKeyReader.seenPrivateKeys)
        assertEquals(emptyList<String>(), identityStore.savedPasswords)
        assertTrue(password.all { it == '\u0000' })
    }

    @Test
    fun `default generator produces an SSH public key line and private key payload`() {
        val generated = DefaultSshKeyGenerator().generate(profile())

        assertTrue(
            generated.publicKeyLine.startsWith("ssh-ed25519 ") ||
                generated.publicKeyLine.startsWith("ecdsa-sha2-nistp256 "),
        )
        assertTrue(generated.privateKeyBytes.decodeToString().startsWith("-----BEGIN PRIVATE KEY-----"))
    }

    private fun service(
        identityStore: FakeIdentityStore = FakeIdentityStore(),
        client: FakeInitializationClient = FakeInitializationClient(fingerprint = "SHA256:new"),
        keyGenerator: SshKeyGenerator = FakeSshKeyGenerator(),
        publicKeyReader: SshPublicKeyReader = FakePublicKeyReader("ssh-ed25519 existing-public-key imported"),
        trustedFingerprint: String?,
        fingerprint: String,
    ): SshInitializationService = SshInitializationService(
        identityStore = identityStore,
        hostKeyStore = FakeHostKeyTrustStore(trustedFingerprint),
        client = client.also { it.fingerprint = fingerprint },
        keyGenerator = keyGenerator,
        publicKeyReader = publicKeyReader,
    )

    private fun profile(identityRefId: String? = null): SshHostProfile = SshHostProfile.create(
        alias = "Dev",
        host = "example.com",
        user = "lee",
        identityRefId = identityRefId,
    )

    private class FakeIdentityStore(
        private val existingBytesById: Map<String, ByteArray> = emptyMap(),
    ) : SshIdentityMaterialStore {
        val importedPayloads = mutableListOf<String>()
        val savedPasswords = mutableListOf<String>()

        override fun importPrivateKey(displayName: String, keyBytes: ByteArray): SshIdentityRef {
            importedPayloads.add(keyBytes.decodeToString())
            return SshIdentityRef(
                id = "generated-identity",
                displayName = displayName,
                protectedPath = "/tmp/generated-identity",
                importedAtMillis = 1L,
            )
        }

        override fun loadProtectedBytesById(identityId: String): ByteArray =
            existingBytesById.getValue(identityId)
    }

    private class FakeHostKeyTrustStore(
        private var trustedFingerprint: String?,
    ) : HostKeyTrustStore {
        override fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust =
            HostKeyTrustPolicy.evaluate(trustedFingerprint, fingerprint)

        override fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted {
            trustedFingerprint = fingerprint
            return HostKeyTrust.Trusted(fingerprint)
        }
    }

    private class FakeInitializationClient(
        var fingerprint: String,
    ) : SshInitializationClient {
        val installedPublicKeys = mutableListOf<String>()
        val passwords = mutableListOf<String>()

        override fun fetchHostFingerprint(target: RemoteTarget): String = fingerprint

        override fun installPublicKey(
            target: RemoteTarget,
            password: CharArray,
            expectedFingerprint: String,
            publicKeyLine: String,
        ) {
            assertEquals(fingerprint, expectedFingerprint)
            passwords.add(password.concatToString())
            installedPublicKeys.add(publicKeyLine)
        }
    }

    private class FakeSshKeyGenerator : SshKeyGenerator {
        override fun generate(profile: SshHostProfile): GeneratedSshKey = GeneratedSshKey(
            privateKeyBytes = "generated-private-key".toByteArray(),
            publicKeyLine = "ssh-ed25519 generated-public-key goblin-android",
        )
    }

    private class FakePublicKeyReader(private val publicKeyLine: String) : SshPublicKeyReader {
        val seenPrivateKeys = mutableListOf<String>()

        override fun publicKeyLine(privateKeyBytes: ByteArray): String {
            seenPrivateKeys.add(privateKeyBytes.decodeToString())
            return publicKeyLine
        }
    }
}
