package dev.goblin.android.ssh

import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.DefaultSecurityProviderConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils

internal class AndroidCompatibleSshConfig private constructor() : DefaultSecurityProviderConfig() {
    override fun initKeyExchangeFactories() {
        super.initKeyExchangeFactories()
        setKeyExchangeFactories(
            keyExchangeFactories.filterNot { it.name.contains(UnsupportedAndroidKeyExchange, ignoreCase = true) },
        )
    }

    companion object {
        fun create(): AndroidCompatibleSshConfig {
            SecurityUtils.setRegisterBouncyCastle(false)
            SecurityUtils.setSecurityProvider(null)
            return AndroidCompatibleSshConfig()
        }

        const val UnsupportedAndroidKeyExchange = "curve25519"
    }
}

internal object SshjClients {
    fun create(): SSHClient = SSHClient(createConfig())

    fun createConfig(): DefaultConfig = AndroidCompatibleSshConfig.create()
}
