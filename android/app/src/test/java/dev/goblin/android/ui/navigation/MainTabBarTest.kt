package dev.goblin.android.ui.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MainTabBarTest {
    @Test
    fun `shouldSwitchMainTab ignores reselecting the active tab`() {
        assertFalse(shouldSwitchMainTab(MainTab.Hosts, MainTab.Hosts))
        assertFalse(shouldSwitchMainTab(MainTab.Projects, MainTab.Projects))
    }

    @Test
    fun `shouldSwitchMainTab allows switching between tabs`() {
        assertTrue(shouldSwitchMainTab(MainTab.Hosts, MainTab.Projects))
        assertTrue(shouldSwitchMainTab(MainTab.Projects, MainTab.Hosts))
    }

    @Test
    fun `main tabs use semantic icons`() {
        assertEquals(MainTabIconKind.Host, mainTabIconKind(MainTab.Hosts))
        assertEquals(MainTabIconKind.Folder, mainTabIconKind(MainTab.Projects))
    }
}
