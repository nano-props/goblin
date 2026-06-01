package dev.goblin.android.terminal

import android.content.Context
import androidx.core.content.ContextCompat

interface TerminalForegroundOwner {
    fun startOrUpdate(content: TerminalNotificationContent)

    fun stop()
}

class TerminalForegroundBridge(
    private val sessionProvider: () -> List<TerminalSessionRecord>,
    private val owner: TerminalForegroundOwner,
    private val onForegroundOwnershipChanged: (Set<String>) -> Unit = {},
) {
    constructor(
        manager: TerminalSessionManager,
        owner: TerminalForegroundOwner,
    ) : this(
        sessionProvider = manager::sessions,
        owner = owner,
        onForegroundOwnershipChanged = manager::markForegroundServiceOwned,
    )

    fun sync() {
        val running = sessionProvider().filter { it.status == TerminalSessionStatus.Running }
        if (running.isEmpty()) {
            onForegroundOwnershipChanged(emptySet())
            owner.stop()
        } else {
            onForegroundOwnershipChanged(running.map { it.id }.toSet())
            owner.startOrUpdate(TerminalNotificationFactory.contentFor(running))
        }
    }
}

class AndroidTerminalForegroundOwner(
    context: Context,
) : TerminalForegroundOwner {
    private val appContext = context.applicationContext

    override fun startOrUpdate(content: TerminalNotificationContent) {
        ContextCompat.startForegroundService(appContext, TerminalForegroundService.startIntent(appContext, content))
    }

    override fun stop() {
        appContext.startService(TerminalForegroundService.stopIntent(appContext))
    }
}
