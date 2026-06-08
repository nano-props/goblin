package dev.goblin.android.termux

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TermuxAndroidContractTest {
    @Test
    fun `manifest declares termux run command permission`() {
        val manifest = androidManifestText()

        assertTrue(
            manifest.contains("""<uses-permission android:name="com.termux.permission.RUN_COMMAND" />"""),
        )
    }

    @Test
    fun `manifest declares termux package visibility`() {
        val manifest = androidManifestText()

        assertTrue(manifest.contains("""<package android:name="com.termux" />"""))
        assertTrue(manifest.contains("""<action android:name="com.termux.RUN_COMMAND" />"""))
    }

    @Test
    fun `hardcoded run command constants match official termux contract`() {
        assertEquals("com.termux", TermuxRunCommandContract.PackageName)
        assertEquals("com.termux.app.RunCommandService", TermuxRunCommandContract.RunCommandServiceName)
        assertEquals("com.termux.permission.RUN_COMMAND", TermuxRunCommandContract.PermissionRunCommand)
        assertEquals("com.termux.RUN_COMMAND", TermuxRunCommandContract.ActionRunCommand)
        assertEquals("com.termux.RUN_COMMAND_PATH", TermuxRunCommandContract.ExtraCommandPath)
        assertEquals("com.termux.RUN_COMMAND_ARGUMENTS", TermuxRunCommandContract.ExtraArguments)
        assertEquals("com.termux.RUN_COMMAND_STDIN", TermuxRunCommandContract.ExtraStdin)
        assertEquals("com.termux.RUN_COMMAND_WORKDIR", TermuxRunCommandContract.ExtraWorkdir)
        assertEquals("com.termux.RUN_COMMAND_BACKGROUND", TermuxRunCommandContract.ExtraBackground)
        assertEquals("com.termux.RUN_COMMAND_SESSION_ACTION", TermuxRunCommandContract.ExtraSessionAction)
        assertEquals("com.termux.RUN_COMMAND_COMMAND_LABEL", TermuxRunCommandContract.ExtraCommandLabel)
        assertEquals(
            "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION",
            TermuxRunCommandContract.ExtraCommandDescription,
        )
        assertEquals("/data/data/com.termux/files/usr/bin/bash", TermuxRunCommandContract.BashPath)
        assertEquals("/data/data/com.termux/files/home", TermuxRunCommandContract.HomePath)
        assertEquals("0", TermuxRunCommandContract.SessionActionSwitchToNewSession)
    }

    private fun androidManifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
            File("android/app/src/main/AndroidManifest.xml"),
        )
        val manifest = candidates.firstOrNull { it.isFile }
            ?: error("AndroidManifest.xml not found from ${File(".").absolutePath}")
        return manifest.readText()
    }
}
