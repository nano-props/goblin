package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.data.ssh.SshIdentityMaterialStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import dev.goblin.android.domain.ssh.SshHostProfile
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.util.Base64
import java.util.concurrent.TimeUnit
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.transport.verification.HostKeyVerifier

sealed interface SshInitializationCheck {
    data object Ready : SshInitializationCheck
    data object NeedsServerPassword : SshInitializationCheck
    data class NeedsHostKeyTrust(val fingerprint: String) : SshInitializationCheck
    data class HostKeyChanged(val previousFingerprint: String, val currentFingerprint: String) : SshInitializationCheck
}

data class SshInitializationResult(
    val profile: SshHostProfile,
)

data class GeneratedSshKey(
    val privateKeyBytes: ByteArray,
    val publicKeyLine: String,
)

interface SshKeyGenerator {
    fun generate(profile: SshHostProfile): GeneratedSshKey
}

interface SshPublicKeyReader {
    fun publicKeyLine(privateKeyBytes: ByteArray): String
}

interface SshInitializationClient {
    fun fetchHostFingerprint(target: RemoteTarget): String

    fun installPublicKey(
        target: RemoteTarget,
        password: CharArray,
        expectedFingerprint: String,
        publicKeyLine: String,
    )
}

class SshInitializationService(
    private val identityStore: SshIdentityMaterialStore,
    private val hostKeyStore: HostKeyTrustStore,
    private val client: SshInitializationClient,
    private val keyGenerator: SshKeyGenerator = DefaultSshKeyGenerator(),
    private val publicKeyReader: SshPublicKeyReader = SshjPublicKeyReader(),
) {
    fun check(profile: SshHostProfile): SshInitializationCheck {
        val target = RemoteTarget.fromHostProfile(profile)
        val fingerprint = client.fetchHostFingerprint(target)
        return when (val trust = hostKeyStore.evaluate(target, fingerprint)) {
            HostKeyTrust.Unknown -> SshInitializationCheck.NeedsHostKeyTrust(fingerprint)
            is HostKeyTrust.Changed -> SshInitializationCheck.HostKeyChanged(
                previousFingerprint = trust.previousFingerprint,
                currentFingerprint = trust.currentFingerprint,
            )
            is HostKeyTrust.Rejected -> SshInitializationCheck.NeedsHostKeyTrust(trust.fingerprint)
            is HostKeyTrust.Trusted -> {
                if (hasUsableIdentity(profile)) SshInitializationCheck.Ready else SshInitializationCheck.NeedsServerPassword
            }
        }
    }

    fun trustHostKey(profile: SshHostProfile, fingerprint: String): HostKeyTrust.Trusted =
        hostKeyStore.trust(RemoteTarget.fromHostProfile(profile), fingerprint)

    fun initialize(profile: SshHostProfile, password: CharArray): SshInitializationResult {
        try {
            val target = RemoteTarget.fromHostProfile(profile)
            val fingerprint = client.fetchHostFingerprint(target)
            val trust = hostKeyStore.evaluate(target, fingerprint)
            require(trust is HostKeyTrust.Trusted) { "Trust this host key before initializing SSH access" }

            val prepared = prepareIdentity(profile)
            val installTarget = RemoteTarget.fromHostProfile(prepared.profile)
            client.installPublicKey(
                target = installTarget,
                password = password,
                expectedFingerprint = fingerprint,
                publicKeyLine = prepared.publicKeyLine,
            )
            return SshInitializationResult(profile = prepared.profile)
        } finally {
            password.fill('\u0000')
        }
    }

    private fun prepareIdentity(profile: SshHostProfile): PreparedIdentity {
        val existingIdentityId = profile.identityRefId
        if (existingIdentityId != null) {
            readExistingPublicKey(existingIdentityId)?.let { publicKeyLine ->
                return PreparedIdentity(
                    profile = profile,
                    publicKeyLine = publicKeyLine,
                )
            }
        }

        val generated = keyGenerator.generate(profile)
        val identity = identityStore.importPrivateKey(
            displayName = "Generated for ${profile.user}@${profile.host}",
            keyBytes = generated.privateKeyBytes,
        )
        return PreparedIdentity(
            profile = profile.copy(identityRefId = identity.id),
            publicKeyLine = generated.publicKeyLine,
        )
    }

    private data class PreparedIdentity(
        val profile: SshHostProfile,
        val publicKeyLine: String,
    )

    private fun hasUsableIdentity(profile: SshHostProfile): Boolean {
        val identityRefId = profile.identityRefId ?: return false
        return readExistingPublicKey(identityRefId) != null
    }

    private fun readExistingPublicKey(identityRefId: String): String? =
        runCatching {
            publicKeyReader.publicKeyLine(identityStore.loadProtectedBytesById(identityRefId))
        }.getOrNull()
}

class DefaultSshKeyGenerator : SshKeyGenerator {
    override fun generate(profile: SshHostProfile): GeneratedSshKey {
        val generator = KeyPairGenerator.getInstance("RSA")
        generator.initialize(GeneratedKeyBits)
        val keyPair = generator.generateKeyPair()
        val privateKey = encodePkcs8Pem(keyPair.private.encoded)
        return GeneratedSshKey(
            privateKeyBytes = privateKey.toByteArray(StandardCharsets.UTF_8),
            publicKeyLine = SshPublicKeyEncoding.publicKeyLine(keyPair.public, "goblin-android"),
        )
    }

    private fun encodePkcs8Pem(encoded: ByteArray): String {
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(encoded)
        return "-----BEGIN PRIVATE KEY-----\n$body\n-----END PRIVATE KEY-----\n"
    }

    private companion object {
        const val GeneratedKeyBits = 3072
    }
}

class SshjPublicKeyReader : SshPublicKeyReader {
    override fun publicKeyLine(privateKeyBytes: ByteArray): String =
        SshPrivateKeys.publicKeyLine(privateKeyBytes, "imported")
}

object SshPublicKeyEncoding {
    fun publicKeyLine(publicKey: PublicKey, comment: String): String {
        val keyType = KeyType.fromKey(publicKey).toString()
        require(keyType != KeyType.UNKNOWN.toString()) { "Unsupported SSH public key type" }
        val blob = Buffer.PlainBuffer().putPublicKey(publicKey).compactDataBase64()
        return "$keyType $blob $comment"
    }

    private fun Buffer.PlainBuffer.compactDataBase64(): String =
        Base64.getEncoder().encodeToString(compactData)
}

class SshjInitializationClient : SshInitializationClient {
    override fun fetchHostFingerprint(target: RemoteTarget): String {
        var fingerprint: String? = null
        SshjClients.create().use { client ->
            client.addHostKeyVerifier(capturingVerifier { fingerprint = it })
            client.connect(target.host, target.port)
        }
        return fingerprint ?: throw SshClientException(
            category = dev.goblin.android.domain.ssh.DiagnosticCategory.HostKey,
            message = "Unable to read host key fingerprint",
        )
    }

    override fun installPublicKey(
        target: RemoteTarget,
        password: CharArray,
        expectedFingerprint: String,
        publicKeyLine: String,
    ) {
        SshjClients.create().use { client ->
            client.addHostKeyVerifier(expectedFingerprintVerifier(expectedFingerprint))
            client.connect(target.host, target.port)
            client.authPassword(target.user, password)
            client.startSession().use { session ->
                val command = session.exec(authorizedKeysInstallScript(publicKeyLine))
                command.join(CommandTimeoutSeconds, TimeUnit.SECONDS)
                val stderr = command.errorStream.readBytes().toString(StandardCharsets.UTF_8).trimEnd()
                val stdout = command.inputStream.readBytes().toString(StandardCharsets.UTF_8).trimEnd()
                val exitStatus = command.exitStatus ?: -1
                if (exitStatus != 0) {
                    throw SshInitializationException(
                        listOf(stderr, stdout, "exit $exitStatus")
                            .firstOrNull { it.isNotBlank() }
                            ?: "SSH initialization failed",
                    )
                }
            }
        }
    }

    private fun authorizedKeysInstallScript(publicKeyLine: String): String {
        val quotedKey = shellQuote(publicKeyLine)
        return """
            umask 077
            mkdir -p "${'$'}HOME/.ssh"
            touch "${'$'}HOME/.ssh/authorized_keys"
            grep -qxF $quotedKey "${'$'}HOME/.ssh/authorized_keys" || printf '%s\n' $quotedKey >> "${'$'}HOME/.ssh/authorized_keys"
            chmod 700 "${'$'}HOME/.ssh"
            chmod 600 "${'$'}HOME/.ssh/authorized_keys"
        """.trimIndent()
    }

    private fun shellQuote(value: String): String = "'${value.replace("'", "'\\''")}'"

    private fun capturingVerifier(onFingerprint: (String) -> Unit): HostKeyVerifier =
        object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
                onFingerprint(SecurityUtils.getFingerprint(key))
                return true
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
        }

    private fun expectedFingerprintVerifier(expectedFingerprint: String): HostKeyVerifier =
        object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, key: PublicKey): Boolean =
                SecurityUtils.getFingerprint(key) == expectedFingerprint

            override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()
        }

    companion object {
        private const val CommandTimeoutSeconds = 15L
    }
}

class SshInitializationException(message: String) : RuntimeException(message)
