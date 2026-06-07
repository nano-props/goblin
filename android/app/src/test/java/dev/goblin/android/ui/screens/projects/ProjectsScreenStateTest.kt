package dev.goblin.android.ui.screens.projects

import dev.goblin.android.domain.ssh.RemoteRepositoryProfile
import org.junit.Assert.assertEquals
import org.junit.Test

class ProjectsScreenStateTest {
    @Test
    fun `empty projects copy describes workspace and terminal only`() {
        val text = emptyProjectsDescription()

        assertEquals("Add a remote Git project to open its workspace and terminal.", text)
    }

    @Test
    fun `project item actions match hosts-style bottom action order`() {
        assertEquals(listOf("Open", "Terminals", "Delete"), projectActionLabels())
    }

    @Test
    fun `project terminal target uses repository id and root path`() {
        val repository = RemoteRepositoryProfile.create(
            hostProfileId = "host-1",
            alias = "App",
            remotePath = "/srv/app",
        ).copy(id = "repo-1")

        val target = projectTerminalTarget(repository)

        assertEquals("repo-1", target.repositoryId)
        assertEquals("/srv/app", target.terminalWorkspacePath)
    }
}
