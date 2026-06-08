package dev.goblin.android.ui.screens.terminals

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class GoblinTerminalViewLayoutTest {
    @Test
    fun `grid size uses measured cell dimensions`() {
        assertEquals(
            TerminalGridSize(columns = 100, rows = 30),
            terminalGridSize(widthPx = 800, heightPx = 540, cellWidthPx = 8, cellHeightPx = 18),
        )
    }

    @Test
    fun `grid size clamps to minimum terminal size`() {
        assertEquals(
            TerminalGridSize(columns = 2, rows = 2),
            terminalGridSize(widthPx = 1, heightPx = 1, cellWidthPx = 8, cellHeightPx = 18),
        )
    }

    @Test
    fun `terminal cell width adds breathing room for small fonts`() {
        assertEquals(9, terminalCellWidthPx(measuredFontWidthPx = 8f))
        assertEquals(12, terminalCellWidthPx(measuredFontWidthPx = 10.2f))
    }

    @Test
    fun `grid size uses adjusted cell width to reduce visual density`() {
        assertEquals(
            TerminalGridSize(columns = 88, rows = 30),
            terminalGridSize(
                widthPx = 800,
                heightPx = 540,
                cellWidthPx = terminalCellWidthPx(measuredFontWidthPx = 8f),
                cellHeightPx = 18,
            ),
        )
    }

    @Test
    fun `fit render scale fills available viewport width`() {
        val grid = terminalGridSize(
            widthPx = 360,
            heightPx = 540,
            cellWidthPx = terminalCellWidthPx(measuredFontWidthPx = 8f),
            cellHeightPx = 18,
        )

        val renderScale = terminalRenderScaleX(
            widthPx = 360,
            gridColumns = grid.columns,
            measuredFontWidthPx = 8f,
            fitToScreen = true,
        )

        assertEquals(40, grid.columns)
        assertEquals(1.125f, renderScale, 0.001f)
        assertEquals(360f, 8f * renderScale * grid.columns, 0.001f)
    }

    @Test
    fun `fit render scale does not increase terminal grid columns`() {
        val grid = terminalGridSize(
            widthPx = 360,
            heightPx = 540,
            cellWidthPx = terminalCellWidthPx(measuredFontWidthPx = 8f),
            cellHeightPx = 18,
        )

        assertEquals(
            40,
            grid.columns,
        )
    }

    @Test
    fun `original width render scale keeps measured renderer width`() {
        assertEquals(
            1f,
            terminalRenderScaleX(
                widthPx = 360,
                gridColumns = 40,
                measuredFontWidthPx = 8f,
                fitToScreen = false,
            ),
            0.001f,
        )
    }

    @Test
    fun `fit render scale never compresses terminal text`() {
        assertEquals(
            1f,
            terminalRenderScaleX(
                widthPx = 300,
                gridColumns = 40,
                measuredFontWidthPx = 8f,
                fitToScreen = true,
            ),
            0.001f,
        )
    }

    @Test
    fun `fit to screen keeps terminal viewport at available width`() {
        assertEquals(
            360.dp,
            terminalViewportWidth(availableWidth = 360.dp, fitToScreen = true),
        )
    }

    @Test
    fun `original width expands terminal viewport for horizontal scrolling`() {
        assertEquals(
            TerminalOriginalViewportWidth,
            terminalViewportWidth(availableWidth = 360.dp, fitToScreen = false),
        )
    }

    @Test
    fun `original width does not shrink wider screens`() {
        assertEquals(
            900.dp,
            terminalViewportWidth(availableWidth = 900.dp, fitToScreen = false),
        )
    }

    @Test
    fun `terminal scrollback offset clamps to transcript range`() {
        assertEquals(
            0,
            terminalScrollbackOffset(currentOffset = 0, deltaRows = -3, activeTranscriptRows = 20),
        )
        assertEquals(
            20,
            terminalScrollbackOffset(currentOffset = 18, deltaRows = 5, activeTranscriptRows = 20),
        )
        assertEquals(
            7,
            terminalScrollbackOffset(currentOffset = 4, deltaRows = 3, activeTranscriptRows = 20),
        )
    }

    @Test
    fun `terminal scrollback follows output only when already at bottom`() {
        assertEquals(
            0,
            terminalScrollbackOffsetForOutput(currentOffset = 0, activeTranscriptRows = 12),
        )
        assertEquals(
            5,
            terminalScrollbackOffsetForOutput(currentOffset = 5, activeTranscriptRows = 12),
        )
        assertEquals(
            12,
            terminalScrollbackOffsetForOutput(currentOffset = 30, activeTranscriptRows = 12),
        )
    }

    @Test
    fun `terminal horizontal offset clamps to content overflow`() {
        assertEquals(
            0,
            terminalHorizontalOffset(
                currentOffsetPx = 0,
                deltaPx = -120,
                contentWidthPx = 720,
                viewportWidthPx = 360,
            ),
        )

        assertEquals(
            240,
            terminalHorizontalOffset(
                currentOffsetPx = 180,
                deltaPx = 60,
                contentWidthPx = 720,
                viewportWidthPx = 360,
            ),
        )

        assertEquals(
            360,
            terminalHorizontalOffset(
                currentOffsetPx = 300,
                deltaPx = 200,
                contentWidthPx = 720,
                viewportWidthPx = 360,
            ),
        )
    }

    @Test
    fun `terminal font size clamps to supported range`() {
        assertEquals(12, TerminalDefaultFontSizeSp)
        assertEquals(TerminalDefaultFontSizeSp + TerminalFontSizeStepSp, terminalAdjustedFontSize(TerminalDefaultFontSizeSp, 1))
        assertEquals(TerminalMinFontSizeSp, terminalAdjustedFontSize(TerminalMinFontSizeSp, -1))
        assertEquals(TerminalMaxFontSizeSp, terminalAdjustedFontSize(TerminalMaxFontSizeSp, 1))
        assertEquals(TerminalDefaultFontSizeSp, terminalAdjustedFontSize(99, 0))
    }
}
