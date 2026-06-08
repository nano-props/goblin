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
        assertEquals(listOf(DiagnosticStage.SSH, DiagnosticStage.Shell), result.stages.map { it.stage })
        assertEquals(List(2) { DiagnosticStatus.Passed }, result.stages.map { it.status })
    }

    @Test
    fun `diagnostics report shell failure`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.CheckShell to failed("shell failed"))).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.ShellFailed, result.category)
        assertStage(result, DiagnosticStage.Shell, DiagnosticStatus.Failed)
    }

    @Test
    fun `host diagnostics do not run git path or repo probes`() {
        val client = FakeSshClient(fingerprint = "SHA256:test", failures = emptyMap())
        val result = SshDiagnosticsService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore("SHA256:test"),
        ).runDiagnostics(target())

        assertTrue(result.ok)
        assertEquals(
            listOf(SshDiagnosticProbe.CheckShell),
            client.probes,
        )
    }

    @Test
    fun `git path and repo probe failures do not make host diagnostics unhealthy`() {
        val result = service(failures = mapOf(SshDiagnosticProbe.CheckGit to failed("git missing"))).runDiagnostics(target())

        assertTrue(result.ok)
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

    @Test
    fun `unknown host key blocks diagnostics before shell probes`() {
        val client = FakeSshClient(fingerprint = "SHA256:new", failures = emptyMap())
        val result = SshDiagnosticsService(
            client = client,
            hostKeyStore = FakeHostKeyTrustStore(null),
        ).runDiagnostics(target())

        assertFalse(result.ok)
        assertEquals(DiagnosticCategory.HostKey, result.category)
        assertEquals("Trust this host key?", result.message)
        assertEquals("SHA256:new", result.hostKeyFingerprint)
        assertTrue(client.probes.isEmpty())
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
        val probes = mutableListOf<SshDiagnosticProbe>()

        override fun fetchHostFingerprint(target: RemoteTarget): String = fingerprint

        override fun runDiagnosticProbe(
            target: RemoteTarget,
            probe: SshDiagnosticProbe,
            secrets: SshConnectionSecrets,
        ): SshCommandResult {
            probes += probe
            return failures[probe] ?: when (probe) {
                SshDiagnosticProbe.CheckShell -> SshCommandResult(ok = true, stdout = "ok")
                SshDiagnosticProbe.CheckGit -> SshCommandResult(ok = true, stdout = "/usr/bin/git")
                SshDiagnosticProbe.TestPath -> SshCommandResult(ok = true)
                SshDiagnosticProbe.RevParseTopLevel -> SshCommandResult(ok = true, stdout = target.remotePath)
            }
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
