package dev.goblin.android.ui.screens.terminals

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.goblin.android.terminals.TerminalSessionState
import dev.goblin.android.terminals.emulator.RemoteTerminalEmulatorController
import dev.goblin.android.ui.theme.GoblinColors
import dev.goblin.android.ui.theme.GoblinSpacing

internal val TerminalOriginalViewportWidth = 720.dp

internal fun terminalViewportWidth(availableWidth: Dp, fitToScreen: Boolean): Dp =
    if (fitToScreen) availableWidth else maxOf(availableWidth, TerminalOriginalViewportWidth)

@Composable
internal fun AndroidTerminalViewport(
    modifier: Modifier = Modifier,
    state: TerminalSessionState,
    emulatorController: RemoteTerminalEmulatorController?,
    fitToScreen: Boolean,
    fontSizeSp: Int,
) {
    val banner = terminalSessionBannerMessage(state)
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(GoblinColors.TerminalBackground),
    ) {
        val horizontalViewportWidthPx = with(LocalDensity.current) { maxWidth.roundToPx() }
        val viewportWidth = terminalViewportWidth(maxWidth, fitToScreen)
        val horizontalScrollState = rememberScrollState()
        val viewportContainerModifier = if (fitToScreen) {
            Modifier.fillMaxSize()
        } else {
            Modifier
                .fillMaxSize()
                .horizontalScroll(horizontalScrollState)
        }
        val viewportContentModifier = if (fitToScreen) {
            Modifier.fillMaxSize()
        } else {
            Modifier
                .width(viewportWidth)
                .fillMaxHeight()
        }
        if (terminalFallbackVisible(emulatorController != null)) {
            Box(modifier = viewportContainerModifier) {
                Text(
                    modifier = viewportContentModifier
                        .padding(GoblinSpacing.Sm),
                    text = terminalDisplayText(state),
                    color = GoblinColors.TerminalForeground,
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = fontSizeSp.sp),
                )
            }
        } else {
            val currentController = requireNotNull(emulatorController)
            Box(modifier = viewportContainerModifier) {
                AndroidView(
                    modifier = viewportContentModifier,
                    factory = { context ->
                        GoblinTerminalView(context).apply {
                            setHorizontalViewportWidthPx(horizontalViewportWidthPx)
                            setFitToScreen(fitToScreen)
                            setFontSizeSp(fontSizeSp)
                            bind(currentController)
                            requestFocus()
                        }
                    },
                    update = { view ->
                        view.setHorizontalViewportWidthPx(horizontalViewportWidthPx)
                        view.setFitToScreen(fitToScreen)
                        view.setFontSizeSp(fontSizeSp)
                        view.bind(currentController)
                        view.requestFocus()
                    },
                )
            }
        }
        banner?.let { message ->
            Text(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .background(GoblinColors.TerminalOverlayBackground)
                    .padding(GoblinSpacing.Sm),
                text = message,
                color = GoblinColors.TerminalOverlayForeground,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
