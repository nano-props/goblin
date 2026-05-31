package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteDirectoryEntry
import dev.goblin.android.domain.ssh.RemoteRepositoryBranch
import dev.goblin.android.domain.ssh.RemoteRepositoryCommit
import dev.goblin.android.domain.ssh.RemoteRepositoryInspection
import dev.goblin.android.domain.ssh.RemoteRepositorySnapshot
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.RemoteTarget

class RemoteRepositoryGitService(
    private val client: SshClientFacade,
    private val hostKeyStore: HostKeyTrustStore,
) {
    fun browseDirectories(target: RemoteTarget): List<RemoteDirectoryEntry> {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = browseDirectoriesScript(target.remotePath),
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Remote directory browse failed" } } }
        return parseRemoteDirectoryEntries(result.stdout)
    }

    fun inspectRepository(target: RemoteTarget): RemoteRepositoryInspection {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = repositoryInspectionScript(target.remotePath),
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Repository validation failed" } } }
        return parseRemoteRepositoryInspection(target.remotePath, result.stdout)
    }

    fun loadSnapshot(target: RemoteTarget): RemoteRepositorySnapshot {
        val fingerprint = trustedFingerprint(target)
        val result = client.runCommand(
            target = target,
            script = snapshotScript(target.remotePath),
            secrets = SshConnectionSecrets(acceptedHostFingerprint = fingerprint),
        )
        require(result.ok) { result.message.ifBlank { result.stderr.ifBlank { "Repository snapshot failed" } } }
        return parseRemoteRepositorySnapshot(result.stdout)
    }

    private fun trustedFingerprint(target: RemoteTarget): String {
        val fingerprint = client.fetchHostFingerprint(target)
        require(hostKeyStore.evaluate(target, fingerprint) is HostKeyTrust.Trusted) {
            "Trust this host key before loading repository data."
        }
        return fingerprint
    }
}

internal fun parseRemoteDirectoryEntries(output: String): List<RemoteDirectoryEntry> =
    output.lineSequence()
        .filter { it.isNotBlank() }
        .mapNotNull { line ->
            val fields = line.split(DirectoryFieldSeparator, limit = 2)
            val name = fields.getOrNull(0).orEmpty()
            val path = fields.getOrNull(1).orEmpty()
            if (name.isBlank() || path.isBlank()) {
                null
            } else {
                RemoteDirectoryEntry(name = name, path = path, isDirectory = true)
            }
        }
        .toList()

internal fun parseRemoteRepositoryInspection(requestedPath: String, output: String): RemoteRepositoryInspection {
    val sections = parseMarkedSections(output, InspectMarkers)
    val topLevel = sections[InspectTopMarker].orEmpty().firstOrNull { it.isNotBlank() }.orEmpty()
    require(topLevel.isNotBlank()) { "Remote path is not a Git repository." }
    return RemoteRepositoryInspection(
        requestedPath = requestedPath,
        topLevel = topLevel,
        currentRef = sections[InspectCurrentMarker].orEmpty().firstOrNull { it.isNotBlank() },
        defaultBranch = sections[InspectDefaultMarker].orEmpty().firstOrNull { it.isNotBlank() },
    )
}

internal fun parseRemoteRepositorySnapshot(output: String): RemoteRepositorySnapshot {
    val sections = parseMarkedSections(output, SnapshotMarkers)

    val worktreeChangeCounts = parseWorktreeStatus(sections[WorktreeStatusMarker].orEmpty())
    val worktrees = parseWorktrees(sections[WorktreesMarker].orEmpty(), worktreeChangeCounts)
    val worktreeByBranch = worktrees.mapNotNull { worktree ->
        worktree.branch?.let { branch -> branch to worktree.path }
    }.toMap()
    val defaultBranch = sections[DefaultMarker].orEmpty().firstOrNull { it.isNotBlank() }
    val branches = sections[BranchesMarker].orEmpty()
        .filter { it.isNotBlank() }
        .map { line ->
            val fields = line.split(BranchFieldSeparator, limit = 2)
            val name = fields.firstOrNull().orEmpty()
            RemoteRepositoryBranch(
                name = name,
                isCurrent = fields.getOrNull(1)?.trim() == "*",
                isDefault = name == defaultBranch,
                worktreePath = worktreeByBranch[name],
            )
        }
        .filter { it.name.isNotBlank() }
    val statusLines = sections[StatusMarker].orEmpty().filter { it.isNotBlank() }

    return RemoteRepositorySnapshot(
        currentRef = sections[CurrentMarker].orEmpty().firstOrNull { it.isNotBlank() },
        defaultBranch = defaultBranch,
        statusLines = statusLines,
        statusChangeCount = statusLines.size,
        branches = branches,
        commits = parseCommits(sections[CommitsMarker].orEmpty()),
        worktrees = worktrees,
    )
}

private fun parseMarkedSections(output: String, markers: Set<String>): Map<String, List<String>> {
    val sections = mutableMapOf<String, MutableList<String>>()
    var currentMarker: String? = null
    output.lineSequence().forEach { line ->
        if (line in markers) {
            currentMarker = line
            sections.getOrPut(line) { mutableListOf() }
        } else {
            currentMarker?.let { sections.getOrPut(it) { mutableListOf() }.add(line) }
        }
    }
    return sections
}

private fun browseDirectoriesScript(remotePath: String): String {
    val path = shellQuote(remotePath)
    return """
        base=${path}
        cd "${'$'}base" 2>/dev/null || exit 20
        base=${'$'}(pwd -P)
        if [ "${'$'}base" != "/" ]; then printf '%s\t%s\n' '..' "${'$'}(dirname "${'$'}base")"; fi
        for name in .* *; do
          [ "${'$'}name" = "." ] && continue
          [ "${'$'}name" = ".." ] && continue
          [ -e "${'$'}name" ] || continue
          [ -d "${'$'}name" ] || continue
          printf '%s\t%s\n' "${'$'}name" "${'$'}base/${'$'}name"
        done
    """.trimIndent()
}

private fun repositoryInspectionScript(remotePath: String): String {
    val repo = shellQuote(remotePath)
    return listOf(
        "top=\$(git -C $repo rev-parse --show-toplevel) || exit 21",
        "printf '%s\\n' ${shellQuote(InspectTopMarker)}",
        "printf '%s\\n' \"\$top\"",
        "printf '%s\\n' ${shellQuote(InspectCurrentMarker)}",
        "git -C $repo symbolic-ref --short HEAD 2>/dev/null || git -C $repo rev-parse --short HEAD 2>/dev/null || true",
        "printf '%s\\n' ${shellQuote(InspectDefaultMarker)}",
        "git -C $repo symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true",
    ).joinToString("\n")
}

private fun snapshotScript(remotePath: String): String {
    val repo = shellQuote(remotePath)
    return listOf(
        "git -C $repo rev-parse --show-toplevel >/dev/null || exit 21",
        "printf '%s\\n' ${shellQuote(CurrentMarker)}",
        "git -C $repo symbolic-ref --short HEAD 2>/dev/null || git -C $repo rev-parse --short HEAD 2>/dev/null || true",
        "printf '%s\\n' ${shellQuote(DefaultMarker)}",
        "git -C $repo symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true",
        "printf '%s\\n' ${shellQuote(StatusMarker)}",
        "git -C $repo status --short",
        "printf '%s\\n' ${shellQuote(CommitsMarker)}",
        "git -C $repo log -n 20 --format='%h%x00%s%x00%an%x00%cr' 2>/dev/null || true",
        "printf '%s\\n' ${shellQuote(BranchesMarker)}",
        "git -C $repo for-each-ref --format='%(refname:short)%00%(HEAD)' refs/heads/",
        "printf '%s\\n' ${shellQuote(WorktreesMarker)}",
        "git -C $repo worktree list --porcelain",
        "printf '%s\\n' ${shellQuote(WorktreeStatusMarker)}",
        "git -C $repo worktree list --porcelain | awk '/^worktree /{print substr(${'$'}0,10)}' | while IFS= read -r wt; do count=${'$'}(git -C \"${'$'}wt\" status --short 2>/dev/null | wc -l | tr -d ' '); printf '%s\\000%s\\n' \"${'$'}wt\" \"${'$'}count\"; done",
    ).joinToString("\n")
}

private fun parseCommits(lines: List<String>): List<RemoteRepositoryCommit> =
    lines.filter { it.isNotBlank() }
        .mapNotNull { line ->
            val fields = line.split(BranchFieldSeparator, limit = 4)
            val shortHash = fields.getOrNull(0).orEmpty()
            val subject = fields.getOrNull(1).orEmpty()
            if (shortHash.isBlank() || subject.isBlank()) {
                null
            } else {
                RemoteRepositoryCommit(
                    shortHash = shortHash,
                    subject = subject,
                    authorName = fields.getOrNull(2)?.takeIf { it.isNotBlank() },
                    relativeDate = fields.getOrNull(3)?.takeIf { it.isNotBlank() },
                )
            }
        }

private fun parseWorktreeStatus(lines: List<String>): Map<String, Int> =
    lines.filter { it.isNotBlank() }
        .mapNotNull { line ->
            val fields = line.split(BranchFieldSeparator, limit = 2)
            val path = fields.getOrNull(0).orEmpty()
            val count = fields.getOrNull(1)?.trim()?.toIntOrNull() ?: 0
            if (path.isBlank()) null else path to count
        }
        .toMap()

private fun parseWorktrees(lines: List<String>, changeCountsByPath: Map<String, Int>): List<RemoteRepositoryWorktree> {
    val worktrees = mutableListOf<RemoteRepositoryWorktree>()
    var path: String? = null
    var branch: String? = null
    var isBare = false
    var isLocked = false
    var isMissing = false

    fun flush() {
        val currentPath = path ?: return
        val isPrimary = worktrees.isEmpty()
        val changeCount = changeCountsByPath[currentPath] ?: 0
        worktrees += RemoteRepositoryWorktree(
            path = currentPath,
            branch = branch,
            isPrimary = isPrimary,
            isLinked = !isPrimary,
            isBare = isBare,
            isLocked = isLocked,
            isMissing = isMissing,
            isDirty = changeCount > 0,
            changeCount = changeCount,
        )
        path = null
        branch = null
        isBare = false
        isLocked = false
        isMissing = false
    }

    (lines + "").forEach { line ->
        when {
            line.isBlank() -> flush()
            line.startsWith("worktree ") -> path = line.removePrefix("worktree ")
            line.startsWith("branch ") -> branch = line.removePrefix("branch ").removePrefix("refs/heads/")
            line == "bare" -> isBare = true
            line.startsWith("locked") -> isLocked = true
            line.startsWith("prunable") -> isMissing = true
        }
    }
    return worktrees
}

private fun shellQuote(value: String): String = "'${value.replace("'", "'\"'\"'")}'"

private const val CurrentMarker = "__GOBLIN_ANDROID_CURRENT__"
private const val DefaultMarker = "__GOBLIN_ANDROID_DEFAULT__"
private const val StatusMarker = "__GOBLIN_ANDROID_STATUS__"
private const val CommitsMarker = "__GOBLIN_ANDROID_COMMITS__"
private const val BranchesMarker = "__GOBLIN_ANDROID_BRANCHES__"
private const val WorktreesMarker = "__GOBLIN_ANDROID_WORKTREES__"
private const val WorktreeStatusMarker = "__GOBLIN_ANDROID_WORKTREE_STATUS__"
private const val InspectTopMarker = "__GOBLIN_ANDROID_INSPECT_TOP__"
private const val InspectCurrentMarker = "__GOBLIN_ANDROID_INSPECT_CURRENT__"
private const val InspectDefaultMarker = "__GOBLIN_ANDROID_INSPECT_DEFAULT__"
private const val DirectoryFieldSeparator = '\t'
private const val BranchFieldSeparator = '\u0000'

private val SnapshotMarkers = setOf(
    CurrentMarker,
    DefaultMarker,
    StatusMarker,
    CommitsMarker,
    BranchesMarker,
    WorktreesMarker,
    WorktreeStatusMarker,
)
private val InspectMarkers = setOf(InspectTopMarker, InspectCurrentMarker, InspectDefaultMarker)
