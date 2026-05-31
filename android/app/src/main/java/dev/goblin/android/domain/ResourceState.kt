package dev.goblin.android.domain

sealed interface ResourceState<out T> {
    data object Idle : ResourceState<Nothing>
    data object Loading : ResourceState<Nothing>
    data class Loaded<T>(val value: T, val loadedAtMillis: Long = System.currentTimeMillis()) : ResourceState<T>
    data class Stale<T>(
        val value: T,
        val loadedAtMillis: Long,
        val reason: String,
    ) : ResourceState<T>
    data class Error(val message: String, val cause: Throwable? = null) : ResourceState<Nothing>
}

