package dev.goblin.android.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionPolicyTest {
    @Test
    fun `does not request notification permission before Android 13`() {
        assertFalse(
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = 32,
                permissionGranted = false,
            ),
        )
    }

    @Test
    fun `does not request notification permission when already granted`() {
        assertFalse(
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = 33,
                permissionGranted = true,
            ),
        )
    }

    @Test
    fun `requests notification permission on Android 13 and later when missing`() {
        assertTrue(
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = 33,
                permissionGranted = false,
            ),
        )
    }

    @Test
    fun `does not request notification permission without a foreground notification need`() {
        assertFalse(
            NotificationPermissionPolicy.shouldRequestNotificationPermission(
                sdkInt = 33,
                permissionGranted = false,
                foregroundNotificationNeeded = false,
            ),
        )
    }
}
