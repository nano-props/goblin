package dev.goblin.android.ui.screens.repositories

import dev.goblin.android.domain.ResourceState
import dev.goblin.android.domain.ssh.RemoteDirectoryEntry
import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import dev.goblin.android.domain.ssh.RemoteRepositoryInspection
import dev.goblin.android.domain.ssh.RemoteRepositorySnapshot
import dev.goblin.android.domain.ssh.RemoteRepositoryWorktree
import dev.goblin.android.domain.ssh.SshHostProfile
import dev.goblin.android.terminal.TerminalDisconnectedReason
import dev.goblin.android.terminal.TerminalSessionRecord
import dev.goblin.android.terminal.TerminalSessionStatus
import dev.goblin.android.ui.screens.placeholders.localTerminalPlaceholderText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RepositorySetupStateTest {
    @Test
    fun `only hosts with identities are selectable as authenticated servers`() {
        val unauthenticated = host(id = "host-1", identityRefId = null)
        val authenticated = host(id = "host-2", identityRefId = "identity-1")

        assertEquals(listOf(authenticated), authenticatedHosts(listOf(unauthenticated, authenticated)))
        assertEquals(authenticated, defaultAuthenticatedHost(listOf(unauthenticated, authenticated)))
    }

    @Test
    fun `remote project paths must be absolute before saving or opening`() {
        assertFalse(canSaveRepository(host(id = "host-1", identityRefId = "identity-1"), "srv/app"))
        assertTrue(canSaveRepository(host(id = "host-1", identityRefId = "identity-1"), "/srv/app"))
    }

    @Test
    fun `directory browser starts from typed absolute path or root`() {
        assertEquals("/srv/app", directoryBrowserRootPath(" /srv/app "))
        assertEquals("/", directoryBrowserRootPath(""))
        assertEquals("/", directoryBrowserRootPath("srv/app"))
    }

    @Test
    fun `directory browser resolves parent path for hierarchical navigation`() {
        assertNull(directoryBrowserParentPath("/"))
        assertEquals("/", directoryBrowserParentPath("/srv"))
        assertEquals("/srv", directoryBrowserParentPath("/srv/app"))
        assertEquals("/srv", directoryBrowserParentPath("/srv/app/"))
    }

    @Test
    fun `directory browser loads only the current page when no usable listing exists`() {
        val entry = RemoteDirectoryEntry(name = "app", path = "/srv/app", isDirectory = true)

        assertTrue(shouldLoadDirectoryPage(null))
        assertTrue(shouldLoadDirectoryPage(ResourceState.Idle))
        assertTrue(shouldLoadDirectoryPage(ResourceState.Error("failed")))
        assertFalse(shouldLoadDirectoryPage(ResourceState.Loading))
        assertFalse(shouldLoadDirectoryPage(ResourceState.Loaded(listOf(entry))))
        assertFalse(
            shouldLoadDirectoryPage(ResourceState.Stale(value = listOf(entry), loadedAtMillis = 1L, reason = "offline")),
        )
    }

    @Test
    fun `workspace terminal uses repository remote path`() {
        val repository = RemoteRepositoryProfile.create(
            hostProfileId = "host-1",
            alias = "App",
            remotePath = "/srv/app",
        )

        assertEquals(
            listOf(
                RepositoryWorkspaceTab.Branches,
                RepositoryWorkspaceTab.Worktrees,
                RepositoryWorkspaceTab.Changes,
                RepositoryWorkspaceTab.Terminal,
            ),
            repositoryWorkspaceTabs(repository),
        )
        assertEquals("/srv/app", repositoryTerminalPath(repository))
    }

    @Test
    fun `workspace detail tabs exclude commits and ports`() {
        val repository = repository(id = "repo-1", remotePath = "/srv/app")

        assertFalse(repositoryWorkspaceTabs(repository).contains(RepositoryWorkspaceTab.Commits))
        assertFalse(repositoryWorkspaceTabs(repository).contains(RepositoryWorkspaceTab.Ports))
    }

    @Test
    fun `workspace detail tabs use a scrollable strip when tab count is dense`() {
        val tabs = repositoryWorkspaceTabs(repository(id = "repo-1", remotePath = "/srv/app"))

        assertFalse(repositoryWorkspaceTabsUseScrollableStrip(tabs))
        assertEquals(0, repositoryWorkspaceTabIndex(tabs, RepositoryWorkspaceTab.Branches))
        assertEquals(
            0,
            repositoryWorkspaceTabIndex(
                tabs = listOf(RepositoryWorkspaceTab.Changes),
                selectedTab = RepositoryWorkspaceTab.Ports,
                fallback = RepositoryWorkspaceTab.Changes,
            ),
        )
    }

    @Test
    fun `local terminal placeholder makes v1 scope explicit`() {
        assertEquals(
            "Android-local terminal and local Git are deferred from v1; use SSH terminals for emergency work.",
            localTerminalPlaceholderText(),
        )
    }

    @Test
    fun `worktree terminal uses selected worktree path`() {
        val worktree = RemoteRepositoryWorktree(
            path = "/srv/app-feature",
            branch = "feature/android",
            isPrimary = false,
            isLinked = true,
            isBare = false,
            isLocked = false,
            isMissing = false,
            isDirty = false,
            changeCount = 0,
        )

        assertEquals("/srv/app-feature", worktreeTerminalPath(worktree))
    }

    @Test
    fun `terminal workspace sessions are filtered by repository and path`() {
        val appTerminal = terminalSession(
            id = "terminal-1",
            repositoryId = "repo-1",
            remotePath = "/srv/app",
            openedAt = 100,
        )
        val otherPath = terminalSession(
            id = "terminal-2",
            repositoryId = "repo-1",
            remotePath = "/srv/other",
            openedAt = 200,
        )
        val otherRepository = terminalSession(
            id = "terminal-3",
            repositoryId = "repo-2",
            remotePath = "/srv/app",
            openedAt = 300,
        )

        assertEquals(
            listOf(appTerminal),
            terminalWorkspaceSessions(
                sessions = listOf(otherPath, appTerminal, otherRepository),
                repositoryId = "repo-1",
                remotePath = "/srv/app",
            ),
        )
    }

    @Test
    fun `terminal workspace sessions order active sessions before inactive by activity`() {
        val olderRunning = terminalSession(
            id = "terminal-1",
            status = TerminalSessionStatus.Running,
            openedAt = 100,
            lastActivityAt = 150,
        )
        val exited = terminalSession(
            id = "terminal-2",
            status = TerminalSessionStatus.Exited,
            openedAt = 200,
            lastActivityAt = 300,
            disconnectedReason = TerminalDisconnectedReason.RemoteExited,
        )
        val newerRunning = terminalSession(
            id = "terminal-3",
            status = TerminalSessionStatus.Running,
            openedAt = 250,
            lastActivityAt = 400,
        )

        assertEquals(
            listOf(newerRunning, olderRunning, exited),
            terminalWorkspaceSessions(
                sessions = listOf(exited, olderRunning, newerRunning),
                repositoryId = "repo-1",
                remotePath = "/srv/app",
            ),
        )
    }

    @Test
    fun `terminal workspace labels are stable and lowercase`() {
        assertEquals("terminal-1", terminalSessionDefaultLabel(index = 0))
        assertEquals("terminal-2", terminalSessionDefaultLabel(index = 1))
        assertEquals("starting", terminalSessionStatusLabel(terminalSession(status = TerminalSessionStatus.Starting)))
        assertEquals("running", terminalSessionStatusLabel(terminalSession(status = TerminalSessionStatus.Running)))
        assertEquals("exited", terminalSessionStatusLabel(terminalSession(status = TerminalSessionStatus.Exited)))
        assertEquals("failed", terminalSessionStatusLabel(terminalSession(status = TerminalSessionStatus.Failed)))
        assertEquals(
            "disconnected",
            terminalSessionStatusLabel(terminalSession(status = TerminalSessionStatus.Disconnected)),
        )
    }

    @Test
    fun `terminal workspace status exposes foreground ownership`() {
        assertEquals(
            "running - foreground",
            terminalSessionStatusLabel(
                terminalSession(
                    status = TerminalSessionStatus.Running,
                    foregroundServiceOwned = true,
                ),
            ),
        )
    }

    @Test
    fun `terminal workspace status includes inactive reason labels`() {
        assertEquals(
            "disconnected - android service stopped",
            terminalSessionStatusLabel(
                terminalSession(
                    status = TerminalSessionStatus.Disconnected,
                    disconnectedReason = TerminalDisconnectedReason.AndroidServiceStopped,
                ),
            ),
        )
        assertEquals(
            "exited - remote exited",
            terminalSessionStatusLabel(
                terminalSession(
                    status = TerminalSessionStatus.Exited,
                    disconnectedReason = TerminalDisconnectedReason.RemoteExited,
                ),
            ),
        )
        assertEquals(
            "failed - terminal failure",
            terminalSessionStatusLabel(
                terminalSession(
                    status = TerminalSessionStatus.Failed,
                    disconnectedReason = TerminalDisconnectedReason.TerminalFailure,
                ),
            ),
        )
    }

    @Test
    fun `running terminal delete requires confirmation`() {
        assertTrue(requiresTerminalDeleteConfirmation(terminalSession(status = TerminalSessionStatus.Starting)))
        assertTrue(requiresTerminalDeleteConfirmation(terminalSession(status = TerminalSessionStatus.Running)))
    }

    @Test
    fun `inactive terminal delete does not require running process confirmation`() {
        assertFalse(requiresTerminalDeleteConfirmation(terminalSession(status = TerminalSessionStatus.Exited)))
        assertFalse(requiresTerminalDeleteConfirmation(terminalSession(status = TerminalSessionStatus.Failed)))
        assertFalse(requiresTerminalDeleteConfirmation(terminalSession(status = TerminalSessionStatus.Disconnected)))
    }

    @Test
    fun `terminal delete confirmation text names terminal and worktree path`() {
        val text = terminalDeleteConfirmationText("Terminal 2", terminalSession(remotePath = "/srv/app-feature"))

        assertTrue(text.contains("Terminal 2"))
        assertTrue(text.contains("/srv/app-feature"))
        assertTrue(text.contains("stop"))
        assertTrue(text.contains("remove"))
    }

    @Test
    fun `worktree path suggestion uses repository parent and sanitized branch name`() {
        assertEquals(
            "/srv/app-feature-android",
            suggestedWorktreePath(repositoryPath = "/srv/app", branch = "feature/android"),
        )
    }

    @Test
    fun `worktree create requires branch and absolute path`() {
        assertFalse(canCreateWorktree(branch = "", worktreePath = "/srv/app-feature"))
        assertFalse(canCreateWorktree(branch = "feature/android", worktreePath = "srv/app-feature"))
        assertTrue(canCreateWorktree(branch = "feature/android", worktreePath = "/srv/app-feature"))
    }

    @Test
    fun `local project delete removes only the selected saved project record`() {
        val app = repository(id = "repo-1", remotePath = "/srv/app")
        val api = repository(id = "repo-2", remotePath = "/srv/api")

        assertEquals(listOf(api), repositoriesAfterLocalDelete(listOf(app, api), "repo-1"))
        assertEquals(listOf(app, api), repositoriesAfterLocalDelete(listOf(app, api), "missing"))
    }

    @Test
    fun `validated repository uses inspected top level before local save`() {
        val host = host(id = "host-1", identityRefId = "identity-1")
        val inspection = RemoteRepositoryInspection(
            requestedPath = "/srv/app/subdir",
            topLevel = "/srv/app",
            currentRef = "feature/android",
            defaultBranch = "main",
        )

        val repository = createRepositoryFromInspection(host, "App", inspection)

        assertEquals("host-1", repository.hostProfileId)
        assertEquals("App", repository.alias)
        assertEquals("/srv/app", repository.remotePath)
    }

    @Test
    fun `refresh failure keeps last loaded snapshot as stale`() {
        val snapshot = snapshot()
        val state = repositorySnapshotStateAfterRefreshFailure(
            previous = ResourceState.Loaded(snapshot, loadedAtMillis = 100),
            message = "git failed",
        )

        require(state is ResourceState.Stale)
        assertEquals(snapshot, state.value)
        assertEquals(100, state.loadedAtMillis)
        assertEquals("git failed", state.reason)
    }

    @Test
    fun `refresh failure without previous snapshot becomes error`() {
        val state = repositorySnapshotStateAfterRefreshFailure(
            previous = ResourceState.Idle,
            message = "git failed",
        )

        require(state is ResourceState.Error)
        assertEquals("git failed", state.message)
    }

    @Test
    fun `worktree badges include linked locked missing dirty and bare states`() {
        val worktree = RemoteRepositoryWorktree(
            path = "/srv/app-linked",
            branch = "feature/android",
            isPrimary = false,
            isLinked = true,
            isBare = true,
            isLocked = true,
            isMissing = true,
            isDirty = true,
            changeCount = 3,
        )

        assertEquals(
            listOf("linked", "locked", "missing", "dirty 3", "bare"),
            worktreeBadges(worktree),
        )
    }

    private fun host(id: String, identityRefId: String?): SshHostProfile =
        SshHostProfile.create(
            alias = "Dev",
            host = "example.com",
            user = "root",
            identityRefId = identityRefId,
        ).copy(id = id)

    private fun repository(id: String, remotePath: String): RemoteRepositoryProfile =
        RemoteRepositoryProfile.create(
            hostProfileId = "host-1",
            alias = null,
            remotePath = remotePath,
        ).copy(id = id)

    private fun terminalSession(
        id: String = "terminal-1",
        repositoryId: String = "repo-1",
        remotePath: String = "/srv/app",
        status: TerminalSessionStatus = TerminalSessionStatus.Running,
        openedAt: Long = 100,
        lastActivityAt: Long? = openedAt,
        foregroundServiceOwned: Boolean = false,
        disconnectedReason: TerminalDisconnectedReason? = null,
    ): TerminalSessionRecord = TerminalSessionRecord(
        id = id,
        hostId = "host-1",
        repositoryId = repositoryId,
        remotePath = remotePath,
        targetLabel = "App - $remotePath",
        status = status,
        openedAt = openedAt,
        lastActivityAt = lastActivityAt,
        foregroundServiceOwned = foregroundServiceOwned,
        disconnectedReason = disconnectedReason,
    )

    private fun snapshot(): RemoteRepositorySnapshot = RemoteRepositorySnapshot(
        currentRef = "main",
        defaultBranch = "main",
        statusLines = emptyList(),
        statusChangeCount = 0,
        branches = emptyList(),
        commits = emptyList(),
        worktrees = emptyList(),
    )
}
