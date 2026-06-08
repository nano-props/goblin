package dev.goblin.android.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class ResourceStateTest {
    @Test
    fun `resource state exposes all phase one states`() {
        val states = listOf(
            ResourceState.Idle,
            ResourceState.Loading,
            ResourceState.Loaded("ok"),
            ResourceState.Stale(value = "old", loadedAtMillis = 1L, reason = "offline"),
            ResourceState.Error("failed"),
        )

        assertEquals(5, states.size)
    }
}

