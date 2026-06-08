package dev.goblin.android.domain.ssh

data class RemoteDirectoryEntry(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
)

data class RemoteRepositoryInspection(
    val requestedPath: String,
    val topLevel: String,
    val currentRef: String?,
    val defaultBranch: String?,
)

data class RemoteRepositorySnapshot(
    val currentRef: String?,
    val defaultBranch: String?,
    val statusLines: List<String>,
    val statusChangeCount: Int,
    val branches: List<RemoteRepositoryBranch>,
    val commits: List<RemoteRepositoryCommit>,
    val worktrees: List<RemoteRepositoryWorktree>,
)

data class RemoteRepositoryBranch(
    val name: String,
    val isCurrent: Boolean,
    val isDefault: Boolean,
    val worktreePath: String?,
)

data class RemoteRepositoryCommit(
    val shortHash: String,
    val subject: String,
    val authorName: String?,
    val relativeDate: String?,
)

data class RemoteRepositoryWorktree(
    val path: String,
    val branch: String?,
    val isPrimary: Boolean,
    val isLinked: Boolean,
    val isBare: Boolean,
    val isLocked: Boolean,
    val isMissing: Boolean,
    val isDirty: Boolean,
    val changeCount: Int,
)
