package dev.goblin.android.ui.screens.terminals

import android.content.Context
import android.graphics.Canvas
import android.graphics.Typeface
import android.text.InputType
import android.util.AttributeSet
import android.util.TypedValue
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import com.termux.view.TerminalRenderer
import dev.goblin.android.terminals.emulator.RemoteTerminalEmulatorController
import kotlin.math.roundToInt

internal data class TerminalGridSize(val columns: Int, val rows: Int)

internal const val TerminalMinFontSizeSp = 12
internal const val TerminalDefaultFontSizeSp = 12
internal const val TerminalMaxFontSizeSp = 24
internal const val TerminalFontSizeStepSp = 2

internal fun terminalHorizontalOffset(
    currentOffsetPx: Int,
    deltaPx: Int,
    contentWidthPx: Int,
    viewportWidthPx: Int,
): Int {
    val maxOffsetPx = (contentWidthPx - viewportWidthPx).coerceAtLeast(0)
    return (currentOffsetPx + deltaPx).coerceIn(0, maxOffsetPx)
}

internal fun terminalAdjustedFontSize(currentFontSizeSp: Int, steps: Int): Int {
    val safeCurrent = currentFontSizeSp.takeIf { it in TerminalMinFontSizeSp..TerminalMaxFontSizeSp }
        ?: TerminalDefaultFontSizeSp
    return (safeCurrent + (steps * TerminalFontSizeStepSp))
        .coerceIn(TerminalMinFontSizeSp, TerminalMaxFontSizeSp)
}

internal fun terminalGridSize(
    widthPx: Int,
    heightPx: Int,
    cellWidthPx: Int,
    cellHeightPx: Int,
): TerminalGridSize {
    val safeCellWidth = cellWidthPx.coerceAtLeast(1)
    val safeCellHeight = cellHeightPx.coerceAtLeast(1)
    return TerminalGridSize(
        columns = (widthPx / safeCellWidth).coerceAtLeast(2),
        rows = (heightPx / safeCellHeight).coerceAtLeast(2),
    )
}

internal fun terminalScrollbackOffset(
    currentOffset: Int,
    deltaRows: Int,
    activeTranscriptRows: Int,
): Int = (currentOffset + deltaRows).coerceIn(0, activeTranscriptRows.coerceAtLeast(0))

internal fun terminalScrollbackOffsetForOutput(
    currentOffset: Int,
    activeTranscriptRows: Int,
): Int = if (currentOffset == 0) {
    0
} else {
    currentOffset.coerceIn(0, activeTranscriptRows.coerceAtLeast(0))
}

internal class GoblinTerminalView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private var controller: RemoteTerminalEmulatorController? = null
    private var observer: AutoCloseable? = null
    private var currentFontSizeSp = TerminalDefaultFontSizeSp
    private var renderer = TerminalRenderer(currentFontSizeSp.spToPx(), Typeface.MONOSPACE)
    private var lastGrid: TerminalGridSize? = null
    private var horizontalViewportWidthPx = 0
    private var horizontalOffsetPx = 0
    private var scrollbackOffsetRows = 0
    private var lastTouchX: Float? = null
    private var lastTouchY: Float? = null
    private var horizontalRemainderPx = 0f
    private var scrollRemainderPx = 0f
    private var touchScrolled = false

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        isVerticalScrollBarEnabled = true
    }

    fun bind(nextController: RemoteTerminalEmulatorController?) {
        if (controller === nextController && observer != null) return
        observer?.close()
        observer = null
        controller = nextController
        lastGrid = null
        horizontalOffsetPx = 0
        scrollbackOffsetRows = 0
        lastTouchX = null
        lastTouchY = null
        horizontalRemainderPx = 0f
        scrollRemainderPx = 0f
        touchScrolled = false
        if (nextController != null) {
            observer = nextController.observe { onTerminalScreenUpdated() }
            updateGrid(width, height)
        }
        invalidate()
    }

    fun setHorizontalViewportWidthPx(nextWidthPx: Int) {
        val safeWidthPx = nextWidthPx.coerceAtLeast(0)
        if (horizontalViewportWidthPx == safeWidthPx) return
        horizontalViewportWidthPx = safeWidthPx
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
    }

    fun setFontSizeSp(nextFontSizeSp: Int) {
        val safeFontSizeSp = terminalAdjustedFontSize(nextFontSizeSp, steps = 0)
        if (currentFontSizeSp == safeFontSizeSp) return
        currentFontSizeSp = safeFontSizeSp
        renderer = TerminalRenderer(currentFontSizeSp.spToPx(), Typeface.MONOSPACE)
        lastGrid = null
        updateGrid(width, height)
        invalidate()
    }

    override fun onDetachedFromWindow() {
        observer?.close()
        observer = null
        controller = null
        lastGrid = null
        horizontalOffsetPx = 0
        scrollbackOffsetRows = 0
        lastTouchX = null
        lastTouchY = null
        horizontalRemainderPx = 0f
        scrollRemainderPx = 0f
        touchScrolled = false
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
        updateGrid(w, h)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val activeController = controller ?: return
        val checkpoint = canvas.save()
        canvas.translate(-horizontalOffsetPx.toFloat(), 0f)
        renderer.render(activeController.emulator, canvas, -scrollbackOffsetRows, -1, -1, -1, -1)
        canvas.restoreToCount(checkpoint)
    }

    override fun computeVerticalScrollRange(): Int =
        controller?.emulator?.screen?.activeRows ?: 1

    override fun computeVerticalScrollExtent(): Int =
        controller?.emulator?.mRows ?: 1

    override fun computeVerticalScrollOffset(): Int {
        val emulator = controller?.emulator ?: return 1
        return emulator.screen.activeRows - scrollbackOffsetRows - emulator.mRows
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (controller == null) return true
        requestFocus()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                lastTouchX = event.x
                lastTouchY = event.y
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                touchScrolled = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val previousX = lastTouchX ?: event.x
                val previousY = lastTouchY ?: event.y
                lastTouchX = event.x
                lastTouchY = event.y
                val horizontalDeltaPx = previousX - event.x + horizontalRemainderPx
                val horizontalStepPx = horizontalDeltaPx.toInt()
                if (horizontalStepPx != 0) {
                    horizontalRemainderPx = horizontalDeltaPx - horizontalStepPx
                    val previousOffsetPx = horizontalOffsetPx
                    setHorizontalOffset(horizontalOffset(horizontalStepPx))
                    if (horizontalOffsetPx != previousOffsetPx) touchScrolled = true
                } else {
                    horizontalRemainderPx = horizontalDeltaPx
                }
                val deltaPx = event.y - previousY + scrollRemainderPx
                val deltaRows = (deltaPx / renderer.fontLineSpacing.coerceAtLeast(1)).toInt()
                if (deltaRows != 0) {
                    scrollRemainderPx = deltaPx - (deltaRows * renderer.fontLineSpacing)
                    setScrollbackOffset(scrollbackOffset(deltaRows))
                    touchScrolled = true
                } else {
                    scrollRemainderPx = deltaPx
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                lastTouchX = null
                lastTouchY = null
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                if (!touchScrolled) performClick()
                touchScrolled = false
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                lastTouchX = null
                lastTouchY = null
                horizontalRemainderPx = 0f
                scrollRemainderPx = 0f
                touchScrolled = false
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_SCROLL || controller == null) {
            return super.onGenericMotionEvent(event)
        }
        val verticalScroll = event.getAxisValue(MotionEvent.AXIS_VSCROLL)
        if (verticalScroll == 0f) return super.onGenericMotionEvent(event)
        val rows = if (verticalScroll > 0f) MouseWheelRows else -MouseWheelRows
        setScrollbackOffset(scrollbackOffset(rows))
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    override fun onCheckIsTextEditor(): Boolean = true

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
        return object : BaseInputConnection(this, true) {
            override fun commitText(text: CharSequence, newCursorPosition: Int): Boolean {
                sendBytes(terminalTextBytes(text))
                getEditable()?.clear()
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                repeat(beforeLength.coerceAtLeast(1)) {
                    sendBytes(byteArrayOf(0x7F.toByte()))
                }
                return true
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val activeController = controller ?: return false
        val bytes = terminalKeyBytes(
            keyCode = keyCode,
            action = event.action,
            ctrlPressed = event.isCtrlPressed,
            altPressed = event.isAltPressed,
            shiftPressed = event.isShiftPressed,
            cursorKeysApplicationMode = activeController.emulator.isCursorKeysApplicationMode,
            keypadApplicationMode = activeController.emulator.isKeypadApplicationMode,
        )
        if (bytes != null) {
            sendBytes(bytes)
            return true
        }

        val unicodeChar = event.unicodeChar
        if (unicodeChar > 0) {
            sendBytes(String(Character.toChars(unicodeChar)).toByteArray(Charsets.UTF_8))
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun updateGrid(widthPx: Int, heightPx: Int) {
        val activeController = controller ?: return
        if (widthPx <= 0 || heightPx <= 0) return
        val cellWidthPx = renderer.fontWidth.roundToInt().coerceAtLeast(1)
        val cellHeightPx = renderer.fontLineSpacing.coerceAtLeast(1)
        val nextGrid = terminalGridSize(widthPx, heightPx, cellWidthPx, cellHeightPx)
        if (nextGrid == lastGrid) return
        lastGrid = nextGrid
        activeController.resize(nextGrid.columns, nextGrid.rows)
    }

    private fun onTerminalScreenUpdated() {
        val activeRows = activeTranscriptRows()
        scrollbackOffsetRows = terminalScrollbackOffsetForOutput(scrollbackOffsetRows, activeRows)
        invalidate()
    }

    private fun scrollbackOffset(deltaRows: Int): Int =
        terminalScrollbackOffset(
            currentOffset = scrollbackOffsetRows,
            deltaRows = deltaRows,
            activeTranscriptRows = activeTranscriptRows(),
        )

    private fun horizontalOffset(deltaPx: Int): Int =
        terminalHorizontalOffset(
            currentOffsetPx = horizontalOffsetPx,
            deltaPx = deltaPx,
            contentWidthPx = width,
            viewportWidthPx = horizontalViewportWidthPx.takeIf { it > 0 } ?: width,
        )

    private fun setHorizontalOffset(nextOffsetPx: Int) {
        if (nextOffsetPx == horizontalOffsetPx) return
        horizontalOffsetPx = nextOffsetPx
        invalidate()
    }

    private fun setScrollbackOffset(nextOffset: Int) {
        if (nextOffset == scrollbackOffsetRows) return
        scrollbackOffsetRows = nextOffset
        if (!awakenScrollBars()) invalidate()
    }

    private fun activeTranscriptRows(): Int =
        controller?.emulator?.screen?.activeTranscriptRows ?: 0

    private fun sendBytes(bytes: ByteArray) {
        controller?.output?.write(bytes, 0, bytes.size)
    }

    private fun Int.spToPx(): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, toFloat(), resources.displayMetrics)
            .roundToInt()
            .coerceAtLeast(1)

    private companion object {
        private const val MouseWheelRows = 3
    }
}
