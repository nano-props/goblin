package dev.goblin.android.ssh

import java.security.Provider
import java.security.Security
import net.schmizz.sshj.common.SecurityUtils
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SshjClientsTest {
    private var originalBcProvider: Provider? = null
    private var originalBcPosition: Int? = null

    @Before
    fun snapshotProvider() {
        originalBcProvider = Security.getProvider(BouncyCastleProviderName)
        originalBcPosition = providerPosition(BouncyCastleProviderName)
    }

    @After
    fun restoreProvider() {
        Security.removeProvider(BouncyCastleProviderName)
        val provider = originalBcProvider
        if (provider != null) {
            Security.insertProviderAt(provider, originalBcPosition ?: 1)
        }
        SecurityUtils.setSecurityProvider(null)
        SecurityUtils.setRegisterBouncyCastle(false)
    }

    @Test
    fun `android compatible config does not offer curve25519 key exchange`() {
        val names = SshjClients.createConfig().keyExchangeFactories.map { it.name.lowercase() }

        assertFalse(names.any { it.contains("curve25519") })
        assertTrue(names.any { it.contains("ecdh-sha2-nistp256") })
    }

    @Test
    fun `android compatible config does not pin crypto lookups to legacy BC provider`() {
        Security.removeProvider(BouncyCastleProviderName)
        Security.insertProviderAt(LegacyBcProvider(), 1)
        SecurityUtils.setSecurityProvider(null)
        SecurityUtils.setRegisterBouncyCastle(true)

        SshjClients.createConfig()

        val digest = SecurityUtils.getMessageDigest("SHA-256")
        assertNotEquals(BouncyCastleProviderName, digest.provider.name)
    }

    private fun providerPosition(name: String): Int? =
        Security.getProviders().indexOfFirst { it.name == name }
            .takeIf { it >= 0 }
            ?.plus(1)

    private class LegacyBcProvider : Provider(
        BouncyCastleProviderName,
        1.0,
        "Legacy Android Bouncy Castle provider",
    )

    private companion object {
        const val BouncyCastleProviderName = "BC"
    }
}
