package dev.goblin.android.notifications

import android.Manifest
import android.os.Build

object NotificationPermissionPolicy {
    const val Permission: String = Manifest.permission.POST_NOTIFICATIONS

    fun shouldRequestNotificationPermission(
        sdkInt: Int,
        permissionGranted: Boolean,
        foregroundNotificationNeeded: Boolean = true,
    ): Boolean = foregroundNotificationNeeded && sdkInt >= Build.VERSION_CODES.TIRAMISU && !permissionGranted
}
