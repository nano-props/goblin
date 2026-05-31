package dev.goblin.android.domain.ssh

enum class DiagnosticStage(val label: String) {
    SSH("SSH"),
    Shell("Shell"),
    Git("Git"),
    Path("Path"),
    Repo("Repo"),
}

enum class DiagnosticStatus(val label: String) {
    Pending("pending"),
    Running("running"),
    Passed("passed"),
    Failed("failed"),
    Skipped("skipped"),
}

enum class DiagnosticCategory(val label: String) {
    AuthFailed("auth failed"),
    HostKey("host key"),
    Unreachable("unreachable"),
    ShellFailed("shell failed"),
    GitMissing("git missing"),
    PathMissing("path missing"),
    NotARepo("not a repo"),
    Timeout("timeout"),
    Cancelled("cancelled"),
    ConfigChanged("config changed"),
    Unknown("unknown"),
}

data class DiagnosticStageResult(
    val stage: DiagnosticStage,
    val status: DiagnosticStatus,
    val category: DiagnosticCategory? = null,
    val message: String = "",
    val details: String = "",
)

data class DiagnosticsResult(
    val target: RemoteTarget,
    val ok: Boolean,
    val stages: List<DiagnosticStageResult>,
    val category: DiagnosticCategory? = null,
    val message: String = "",
    val details: String = "",
    val hostKeyFingerprint: String? = null,
)

