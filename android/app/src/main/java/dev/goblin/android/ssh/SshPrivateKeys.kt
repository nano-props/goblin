package dev.goblin.android.ssh

import java.nio.charset.StandardCharsets
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource

internal object SshPrivateKeys {
    fun keyProvider(
        client: SSHClient,
        identityBytes: ByteArray,
        passphrase: CharArray?,
    ): KeyProvider = SshKeyCompatibility.keyProviderForSshj(
        client.loadKeys(
            identityBytes.toString(StandardCharsets.UTF_8),
            null as String?,
            StaticPasswordFinder(passphrase),
        ),
    )

    fun publicKeyLine(privateKeyBytes: ByteArray, comment: String): String =
        SshjClients.create().use { client ->
            SshPublicKeyEncoding.publicKeyLine(
                keyProvider(client, privateKeyBytes, passphrase = null).public,
                comment,
            )
        }

    private class StaticPasswordFinder(private val value: CharArray?) : PasswordFinder {
        override fun reqPassword(resource: Resource<*>?): CharArray = value ?: CharArray(0)
        override fun shouldRetry(resource: Resource<*>?): Boolean = false
    }
}
