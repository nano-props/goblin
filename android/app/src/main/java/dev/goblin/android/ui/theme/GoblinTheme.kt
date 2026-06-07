package dev.goblin.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object GoblinColors {
    const val AccentHex = "#2563EB"
    const val SuccessHex = "#16A34A"
    const val WarningHex = "#D97706"
    const val DestructiveHex = "#DC2626"
    const val TerminalBackgroundHex = "#0B0F14"
    const val TerminalForegroundHex = "#E5E7EB"
    const val TerminalOverlayBackgroundHex = "#111827"
    const val TerminalOverlayForegroundHex = TerminalForegroundHex
    const val TerminalInputBackgroundHex = "#111827"
    const val TerminalInputBorderHex = "#334155"
    const val TerminalInputForegroundHex = TerminalForegroundHex
    const val TerminalInputPlaceholderHex = "#94A3B8"
    const val TerminalActionForegroundHex = "#60A5FA"
    const val TerminalDisabledForegroundHex = "#94A3B8"

    val Accent = Color(0xFF2563EB)
    val Success = Color(0xFF16A34A)
    val Warning = Color(0xFFD97706)
    val Destructive = Color(0xFFDC2626)
    val TerminalBackground = Color(0xFF0B0F14)
    val TerminalForeground = Color(0xFFE5E7EB)
    val TerminalOverlayBackground = Color(0xFF111827)
    val TerminalOverlayForeground = TerminalForeground
    val TerminalInputBackground = Color(0xFF111827)
    val TerminalInputBorder = Color(0xFF334155)
    val TerminalInputForeground = TerminalForeground
    val TerminalInputPlaceholder = Color(0xFF94A3B8)
    val TerminalActionForeground = Color(0xFF60A5FA)
    val TerminalDisabledForeground = Color(0xFF94A3B8)
}

object GoblinSpacing {
    val Xs = 4.dp
    val Sm = 8.dp
    val Md = 16.dp
    val Lg = 24.dp
    val Xl = 32.dp
    val TwoXl = 48.dp
    val ThreeXl = 64.dp
}

private val LightScheme = lightColorScheme(
    primary = GoblinColors.Accent,
    error = GoblinColors.Destructive,
    background = Color(0xFFF8FAFC),
    surface = Color(0xFFFFFFFF),
    onBackground = Color(0xFF111827),
    onSurface = Color(0xFF111827),
)

private val DarkScheme = darkColorScheme(
    primary = GoblinColors.Accent,
    error = GoblinColors.Destructive,
    background = Color(0xFF101214),
    surface = Color(0xFF1A1D21),
    onBackground = Color(0xFFE5E7EB),
    onSurface = Color(0xFFE5E7EB),
)

@Composable
fun GoblinTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = MaterialTheme.typography,
        content = content,
    )
}
