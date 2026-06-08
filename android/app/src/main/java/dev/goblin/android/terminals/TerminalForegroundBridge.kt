package dev.goblin.android.terminals

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
    private var lastState: ForegroundState? = null

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
        val runningIds = running.map { it.id }.toSet()
        val content = running.takeIf { it.isNotEmpty() }?.let(TerminalNotificationFactory::contentFor)
        val nextState = ForegroundState(runningIds = runningIds, content = content)
        if (nextState == lastState) return
        lastState = nextState

        if (running.isEmpty()) {
            onForegroundOwnershipChanged(emptySet())
            owner.stop()
        } else {
            onForegroundOwnershipChanged(runningIds)
            owner.startOrUpdate(requireNotNull(content))
        }
    }

    private data class ForegroundState(
        val runningIds: Set<String>,
        val content: TerminalNotificationContent?,
    )
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
