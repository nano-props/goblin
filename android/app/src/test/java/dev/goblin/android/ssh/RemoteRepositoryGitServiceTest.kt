package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustPolicy
import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteRepositoryGitServiceTest {
    @Test
    fun `directory listing parser keeps parent and child directories`() {
        val output = """
            ..	/home/lee
            app	/home/lee/app
            api	/home/lee/api
        """.trimIndent()

        val entries = parseRemoteDirectoryEntries(output)

        assertEquals("..", entries[0].name)
        assertEquals("/home/lee", entries[0].path)
        assertEquals("app", entries[1].name)
        assertEquals("/home/lee/app", entries[1].path)
        assertTrue(entries.all { it.isDirectory })
    }

    @Test
    fun `directory listing parser normalizes root child paths`() {
        val output = """
            home	//home
            srv	//srv
        """.trimIndent()

        val entries = parseRemoteDirectoryEntries(output)

        assertEquals("/home", entries[0].path)
        assertEquals("/srv", entries[1].path)
    }

    @Test
    fun `repository inspection parser reads top level current ref and default branch`() {
        val output = """
            __GOBLIN_ANDROID_INSPECT_TOP__
            /srv/app
            __GOBLIN_ANDROID_INSPECT_CURRENT__
            feature/android
            __GOBLIN_ANDROID_INSPECT_DEFAULT__
            main
        """.trimIndent()

        val inspection = parseRemoteRepositoryInspection("/srv/app/subdir", output)

        assertEquals("/srv/app", inspection.topLevel)
        assertEquals("feature/android", inspection.currentRef)
        assertEquals("main", inspection.defaultBranch)
    }

    @Test
    fun `repository inspection rejects non git paths`() {
        val client = FakeSshClient(
            commandResults = listOf(
                SshCommandResult(ok = false, stderr = "fatal: not a git repository", message = "fatal: not a git repository"),
            ),
        )
        val service = RemoteRepositoryGitService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.inspectRepository(target("/srv/not-a-repo"))
        }

        assertEquals("fatal: not a git repository", error.message)
    }

    @Test
    fun `directory browse is blocked until host key is trusted`() {
        val service = RemoteRepositoryGitService(
            client = FakeSshClient(),
            hostKeyStore = FakeHostKeyTrustStore(null),
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            service.browseDirectories(target("/srv"))
        }

        assertEquals("Trust this host key before loading repository data.", error.message)
    }

    @Test
    fun `snapshot parser maps branches to existing worktree paths`() {
        val output = """
            __GOBLIN_ANDROID_CURRENT__
            main
            __GOBLIN_ANDROID_DEFAULT__
            main
            __GOBLIN_ANDROID_STATUS__
             M app/src/Main.kt
            ?? notes.md
            __GOBLIN_ANDROID_COMMITS__
            abc123${'\u0000'}Fix terminal input${'\u0000'}Lee${'\u0000'}2 hours ago
            __GOBLIN_ANDROID_BRANCHES__
            main${'\u0000'}*
            feature/android${'\u0000'} 
            __GOBLIN_ANDROID_WORKTREES__
            worktree /srv/app
            HEAD abc123
            branch refs/heads/main
            
            worktree /srv/app-feature-android
            HEAD def456
            branch refs/heads/feature/android
            locked dependency update

            worktree /srv/app-missing
            HEAD fed321
            branch refs/heads/missing
            prunable gitdir file points to non-existent location
            __GOBLIN_ANDROID_WORKTREE_STATUS__
            /srv/app${'\u0000'}2
            /srv/app-feature-android${'\u0000'}0
            /srv/app-missing${'\u0000'}0
        """.trimIndent()

        val snapshot = parseRemoteRepositorySnapshot(output)

        assertEquals("main", snapshot.currentRef)
        assertEquals("main", snapshot.defaultBranch)
        assertEquals(2, snapshot.statusChangeCount)
        assertEquals("abc123", snapshot.commits.single().shortHash)
        assertEquals("Fix terminal input", snapshot.commits.single().subject)
        assertEquals(listOf(" M app/src/Main.kt", "?? notes.md"), snapshot.statusLines)
        assertEquals("/srv/app", snapshot.branches.first { it.name == "main" }.worktreePath)
        assertTrue(snapshot.branches.first { it.name == "main" }.isCurrent)
        assertTrue(snapshot.branches.first { it.name == "main" }.isDefault)
        assertEquals("/srv/app-feature-android", snapshot.branches.first { it.name == "feature/android" }.worktreePath)
        assertFalse(snapshot.worktrees.last().isPrimary)
        assertTrue(snapshot.worktrees.first { it.path == "/srv/app" }.isDirty)
        assertEquals(2, snapshot.worktrees.first { it.path == "/srv/app" }.changeCount)
        assertTrue(snapshot.worktrees.first { it.path == "/srv/app-feature-android" }.isLinked)
        assertTrue(snapshot.worktrees.first { it.path == "/srv/app-feature-android" }.isLocked)
        assertTrue(snapshot.worktrees.first { it.path == "/srv/app-missing" }.isMissing)
    }

    @Test
    fun `snapshot parser keeps detached and bare worktree states`() {
        val output = """
            __GOBLIN_ANDROID_CURRENT__
            abc123
            __GOBLIN_ANDROID_DEFAULT__
            main
            __GOBLIN_ANDROID_STATUS__
            __GOBLIN_ANDROID_COMMITS__
            __GOBLIN_ANDROID_BRANCHES__
            main${'\u0000'}${' '}
            __GOBLIN_ANDROID_WORKTREES__
            worktree /srv/app
            HEAD abc123
            bare

            worktree /srv/app-detached
            HEAD def456
            __GOBLIN_ANDROID_WORKTREE_STATUS__
            /srv/app${'\u0000'}0
            /srv/app-detached${'\u0000'}0
        """.trimIndent()

        val snapshot = parseRemoteRepositorySnapshot(output)

        assertEquals("abc123", snapshot.currentRef)
        assertTrue(snapshot.worktrees.first { it.path == "/srv/app" }.isBare)
        assertEquals(null, snapshot.worktrees.first { it.path == "/srv/app" }.branch)
        assertEquals(null, snapshot.worktrees.first { it.path == "/srv/app-detached" }.branch)
        assertFalse(snapshot.branches.single().isCurrent)
    }

    private fun target(remotePath: String): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22$remotePath",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = remotePath,
        identityRefId = "identity-1",
    )

    private class FakeSshClient(
        private val fingerprint: String = "SHA256:test",
        private val commandResults: List<SshCommandResult> = emptyList(),
    ) : SshClientFacade {
        private var commandIndex = 0

        override fun fetchHostFingerprint(target: RemoteTarget): String = fingerprint

        override fun runDiagnosticProbe(
            target: RemoteTarget,
            probe: SshDiagnosticProbe,
            secrets: SshConnectionSecrets,
        ): SshCommandResult = SshCommandResult(ok = true)

        override fun runCommand(
            target: RemoteTarget,
            script: String,
            secrets: SshConnectionSecrets,
        ): SshCommandResult = commandResults.getOrNull(commandIndex++) ?: SshCommandResult(ok = true, stdout = "")
    }

    private class FakeHostKeyTrustStore(
        private var trustedFingerprint: String?,
    ) : HostKeyTrustStore {
        override fun evaluate(target: RemoteTarget, fingerprint: String): HostKeyTrust =
            HostKeyTrustPolicy.evaluate(trustedFingerprint, fingerprint)

        override fun trust(target: RemoteTarget, fingerprint: String): HostKeyTrust.Trusted {
            trustedFingerprint = fingerprint
            return HostKeyTrust.Trusted(fingerprint)
        }
    }
}
