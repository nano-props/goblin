package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustPolicy
import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.DiagnosticCategory
import dev.goblin.android.domain.ssh.DiagnosticStage
import dev.goblin.android.domain.ssh.DiagnosticStatus
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SshDiagnosticsServiceTest {
    @Test
    fun `diagnostics pass when all probes succeed`() {
        val result = service().runDiagnostics(target())

        assertTrue(result.ok)
        assertEquals(List(5) { DiagnosticStatus.Passed }, result.stages.map { it.status })
    }

    @Test
    fun `diagnostics report shell failure`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.CheckShell to failed("shell failed"))).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.ShellFailed, result.category)
        assertStage(result, DiagnosticStage.Shell, DiagnosticStatus.Failed)
    }

    @Test
    fun `diagnostics report Git missing`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.CheckGit to failed("git missing"))).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.GitMissing, result.category)
        assertStage(result, DiagnosticStage.Git, DiagnosticStatus.Failed)
    }

    @Test
    fun `diagnostics report path missing`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.TestPath to failed("path missing"))).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.PathMissing, result.category)
        assertStage(result, DiagnosticStage.Path, DiagnosticStatus.Failed)
    }

    @Test
    fun `diagnostics report not a repo`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.RevParseTopLevel to failed("not a repo"))).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.NotARepo, result.category)
        assertStage(result, DiagnosticStage.Repo, DiagnosticStatus.Failed)
    }

    @Test
    fun `changed host key blocks diagnostics before shell probes`() {
        val result = service(trustedFingerprint = "SHA256:old", fingerprint = "SHA256:new").runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.HostKey, result.category)
        assertEquals("Host key changed. Review the fingerprint before trusting this host again.", result.message)
        assertStage(result, DiagnosticStage.SSH, DiagnosticStatus.Failed)
        assertStage(result, DiagnosticStage.Shell, DiagnosticStatus.Skipped)
    }

    private fun service(
        trustedFingerprint: String = "SHA256:test",
        fingerprint: String = "SHA256:test",
        failures: Map<SshDiagnosticProbe, SshCommandResult> = emptyMap(),
    ): SshDiagnosticsService = SshDiagnosticsService(
        client = FakeSshClient(fingerprint = fingerprint, failures = failures),
        hostKeyStore = FakeHostKeyTrustStore(trustedFingerprint),
    )

    private fun target(): RemoteTarget = RemoteTarget(
        id = "lee@example.com:22/home/lee/app",
        alias = "Dev",
        host = "example.com",
        user = "lee",
        port = 22,
        remotePath = "/home/lee/app",
        identityRefId = "identity-1",
    )

    private fun failed(message: String): SshCommandResult = SshCommandResult(ok = false, stderr = message, message = message)

    private fun assertStage(result: dev.goblin.android.domain.ssh.DiagnosticsResult, stage: DiagnosticStage, status: DiagnosticStatus) {
        assertEquals(status, result.stages.single { it.stage == stage }.status)
    }

    private class FakeSshClient(
        private val fingerprint: String,
        private val failures: Map<SshDiagnosticProbe, SshCommandResult>,
    ) : SshClientFacade {
        override fun fetchHostFingerprint(target: RemoteTarget): String = fingerprint

        override fun runDiagnosticProbe(
            target: RemoteTarget,
            probe: SshDiagnosticProbe,
            secrets: SshConnectionSecrets,
        ): SshCommandResult = failures[probe] ?: when (probe) {
            SshDiagnosticProbe.CheckShell -> SshCommandResult(ok = true, stdout = "ok")
            SshDiagnosticProbe.CheckGit -> SshCommandResult(ok = true, stdout = "/usr/bin/git")
            SshDiagnosticProbe.TestPath -> SshCommandResult(ok = true)
            SshDiagnosticProbe.RevParseTopLevel -> SshCommandResult(ok = true, stdout = target.remotePath)
        }
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

