package dev.goblin.android.runtime

import org.junit.Test

class RuntimeDependencyClasspathTest {
    @Test
    fun `profile installer future dependencies are runtime loadable`() {
        Class.forName("com.google.common.util.concurrent.ListenableFuture")
        Class.forName("androidx.concurrent.futures.AbstractResolvableFuture")
    }
}
