package dev.goblin.android.ssh

import dev.goblin.android.data.ssh.HostKeyTrustStore
import dev.goblin.android.domain.ssh.DiagnosticCategory
import dev.goblin.android.domain.ssh.DiagnosticStage
import dev.goblin.android.domain.ssh.DiagnosticStageResult
import dev.goblin.android.domain.ssh.DiagnosticStatus
import dev.goblin.android.domain.ssh.DiagnosticsResult
import dev.goblin.android.domain.ssh.HostKeyTrust
import dev.goblin.android.domain.ssh.RemoteTarget

class SshDiagnosticsService(
    private val client: SshClientFacade,
    private val hostKeyStore: HostKeyTrustStore,
) {
    fun runDiagnostics(
        target: RemoteTarget,
        secrets: SshConnectionSecrets = SshConnectionSecrets(),
    ): DiagnosticsResult {
        val stages = createStages()
        val fingerprint = try {
            client.fetchHostFingerprint(target)
        } catch (err: SshClientException) {
            return fail(target, stages, 0, err.category, err.message, err.cause?.message.orEmpty())
        } catch (err: Throwable) {
            return fail(target, stages, 0, DiagnosticCategory.Unreachable, err.message ?: "SSH failed", "")
        }

        when (val trust = hostKeyStore.evaluate(target, fingerprint)) {
            HostKeyTrust.Unknown -> {
                return fail(
                    target = target,
                    stages = stages,
                    failedIndex = 0,
                    category = DiagnosticCategory.HostKey,
                    message = "Trust this host key?",
                    details = fingerprint,
                    hostKeyFingerprint = fingerprint,
                )
            }

            is HostKeyTrust.Changed -> {
                return fail(
                    target = target,
                    stages = stages,
                    failedIndex = 0,
                    category = DiagnosticCategory.HostKey,
                    message = "Host key changed. Review the fingerprint before trusting this host again.",
                    details = "previous=${trust.previousFingerprint}\ncurrent=${trust.currentFingerprint}",
                    hostKeyFingerprint = fingerprint,
                )
            }

            is HostKeyTrust.Rejected -> {
                return fail(target, stages, 0, DiagnosticCategory.HostKey, "Host key rejected.", trust.fingerprint)
            }

            is HostKeyTrust.Trusted -> stages[0] = stages[0].copy(status = DiagnosticStatus.Passed)
        }

        val trustedSecrets = secrets.copy(acceptedHostFingerprint = fingerprint)

        val shell = runProbe(target, SshDiagnosticProbe.CheckShell, trustedSecrets)
        if (!shell.ok) return fail(target, stages, 1, DiagnosticCategory.ShellFailed, shell.message, shell.details())
        if (shell.stdout.trim() != "ok") return fail(target, stages, 1, DiagnosticCategory.ShellFailed, "shell failed", shell.details())
        stages[1] = stages[1].copy(status = DiagnosticStatus.Passed)

        return DiagnosticsResult(target = target, ok = true, stages = stages)
    }

    private fun runProbe(
        target: RemoteTarget,
        probe: SshDiagnosticProbe,
        secrets: SshConnectionSecrets,
    ): SshCommandResult = try {
        client.runDiagnosticProbe(target, probe, secrets)
    } catch (err: SshClientException) {
        SshCommandResult(ok = false, message = err.message, stderr = err.cause?.message.orEmpty())
    } catch (err: Throwable) {
        SshCommandResult(ok = false, message = err.message ?: "SSH failed")
    }

    private fun createStages(): MutableList<DiagnosticStageResult> = mutableListOf(
        DiagnosticStageResult(DiagnosticStage.SSH, DiagnosticStatus.Pending),
        DiagnosticStageResult(DiagnosticStage.Shell, DiagnosticStatus.Pending),
    )

    private fun fail(
        target: RemoteTarget,
        stages: MutableList<DiagnosticStageResult>,
        failedIndex: Int,
        category: DiagnosticCategory,
        message: String,
        details: String,
        hostKeyFingerprint: String? = null,
    ): DiagnosticsResult {
        for (index in stages.indices) {
            stages[index] = when {
                index < failedIndex -> stages[index].copy(status = DiagnosticStatus.Passed)
                index == failedIndex -> stages[index].copy(
                    status = DiagnosticStatus.Failed,
                    category = category,
                    message = message,
                    details = details,
                )

                else -> stages[index].copy(status = DiagnosticStatus.Skipped)
            }
        }
        return DiagnosticsResult(
            target = target,
            ok = false,
            stages = stages,
            category = category,
            message = message,
            details = details,
            hostKeyFingerprint = hostKeyFingerprint,
        )
    }

    private fun SshCommandResult.details(): String = listOf(stderr, stdout).filter { it.isNotBlank() }.joinToString("\n")
}
