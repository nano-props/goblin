package dev.goblin.android.termux

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

internal object TermuxRunCommandContract {
    const val PackageName = "com.termux"
    const val RunCommandServiceName = "com.termux.app.RunCommandService"
    const val PermissionRunCommand = "com.termux.permission.RUN_COMMAND"
    const val ActionRunCommand = "com.termux.RUN_COMMAND"
    const val ExtraCommandPath = "com.termux.RUN_COMMAND_PATH"
    const val ExtraArguments = "com.termux.RUN_COMMAND_ARGUMENTS"
    const val ExtraStdin = "com.termux.RUN_COMMAND_STDIN"
    const val ExtraWorkdir = "com.termux.RUN_COMMAND_WORKDIR"
    const val ExtraBackground = "com.termux.RUN_COMMAND_BACKGROUND"
    const val ExtraSessionAction = "com.termux.RUN_COMMAND_SESSION_ACTION"
    const val ExtraCommandLabel = "com.termux.RUN_COMMAND_COMMAND_LABEL"
    const val ExtraCommandDescription = "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION"
    const val BashPath = "/data/data/com.termux/files/usr/bin/bash"
    const val HomePath = "/data/data/com.termux/files/home"
    const val SessionActionSwitchToNewSession = "0"
}

class AndroidExternalTermuxEnvironment(
    context: Context,
) : ExternalTermuxEnvironment {
    private val appContext = context.applicationContext

    override fun isTermuxInstalled(): Boolean =
        packageManager().getLaunchIntentForPackage(TermuxRunCommandContract.PackageName) != null ||
            runCatching {
                packageManager().getPackageInfo(TermuxRunCommandContract.PackageName, 0)
            }.isSuccess

    override fun canRunCommandDirectly(): Boolean =
        isTermuxInstalled() &&
            ContextCompat.checkSelfPermission(
                appContext,
                TermuxRunCommandContract.PermissionRunCommand,
            ) == PackageManager.PERMISSION_GRANTED

    override fun launchRunCommand(command: String, stdin: String?): Boolean =
        runCatching {
            val intent = Intent(TermuxRunCommandContract.ActionRunCommand)
                .setClassName(
                    TermuxRunCommandContract.PackageName,
                    TermuxRunCommandContract.RunCommandServiceName,
                )
                .putExtra(TermuxRunCommandContract.ExtraCommandPath, TermuxRunCommandContract.BashPath)
                .putExtra(TermuxRunCommandContract.ExtraArguments, arrayOf("-lc", command))
                .putExtra(TermuxRunCommandContract.ExtraWorkdir, TermuxRunCommandContract.HomePath)
                .putExtra(TermuxRunCommandContract.ExtraBackground, false)
                .putExtra(
                    TermuxRunCommandContract.ExtraSessionAction,
                    TermuxRunCommandContract.SessionActionSwitchToNewSession,
                )
                .putExtra(TermuxRunCommandContract.ExtraCommandLabel, "Goblin workspace SSH")
                .putExtra(
                    TermuxRunCommandContract.ExtraCommandDescription,
                    "Open the selected Goblin workspace over SSH.",
                )
            if (stdin != null) {
                intent.putExtra(TermuxRunCommandContract.ExtraStdin, stdin)
            }
            appContext.startService(intent) != null
        }.getOrDefault(false)

    override fun copyCommand(command: String): Boolean =
        runCatching {
            val clipboard = ContextCompat.getSystemService(appContext, ClipboardManager::class.java)
                ?: return false
            clipboard.setPrimaryClip(ClipData.newPlainText("Goblin Termux SSH command", command))
            true
        }.getOrDefault(false)

    override fun openTermux(): Boolean =
        runCatching {
            val intent = packageManager().getLaunchIntentForPackage(TermuxRunCommandContract.PackageName)
                ?: return false
            appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }.getOrDefault(false)

    private fun packageManager(): PackageManager = appContext.packageManager
}
