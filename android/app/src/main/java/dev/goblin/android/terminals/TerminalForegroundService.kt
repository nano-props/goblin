package dev.goblin.android.terminals

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import dev.goblin.android.MainActivity
import dev.goblin.android.R

class TerminalForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ActionStop) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val content = TerminalNotificationContent(
            title = intent?.getStringExtra(ExtraTitle) ?: "Terminal running",
            text = intent?.getStringExtra(ExtraText) ?: "Terminal session active",
            terminalSessionId = intent?.getStringExtra(TerminalSessionIntentExtra),
        )
        ServiceCompat.startForeground(
            this,
            TerminalNotificationFactory.NotificationId,
            buildNotification(content),
            foregroundServiceType(),
        )
        return START_STICKY
    }

    private fun buildNotification(content: TerminalNotificationContent): Notification {
        ensureChannel()
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            content.terminalSessionId?.let { putExtra(TerminalSessionIntentExtra, it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            TerminalNotificationFactory.NotificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, TerminalNotificationFactory.ChannelId)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            TerminalNotificationFactory.ChannelId,
            TerminalNotificationFactory.ChannelName,
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun foregroundServiceType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }

    companion object {
        private const val ActionStartOrUpdate = "dev.goblin.android.terminals.START_OR_UPDATE"
        private const val ActionStop = "dev.goblin.android.terminals.STOP"
        private const val ExtraTitle = "dev.goblin.android.terminals.extra.TITLE"
        private const val ExtraText = "dev.goblin.android.terminals.extra.TEXT"

        fun startIntent(context: Context, content: TerminalNotificationContent): Intent =
            Intent(context, TerminalForegroundService::class.java).apply {
                action = ActionStartOrUpdate
                putExtra(ExtraTitle, content.title)
                putExtra(ExtraText, content.text)
                content.terminalSessionId?.let { putExtra(TerminalSessionIntentExtra, it) }
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, TerminalForegroundService::class.java).apply {
                action = ActionStop
            }
    }
}
