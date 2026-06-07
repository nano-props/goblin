package dev.goblin.android.terminals.emulator

import android.os.Handler
import android.os.Looper
import com.termux.terminal.TerminalEmulator
import java.util.UUID

class RemoteTerminalEmulatorController(
    val sessionId: String,
    initialColumns: Int = 80,
    initialRows: Int = 24,
    private val postToMain: ((() -> Unit) -> Unit) = mainThreadPoster(),
    sendInputBytes: (ByteArray) -> Boolean,
    private val resizeRemote: (Int, Int) -> Boolean,
) {
    val output: RemoteTerminalOutput = RemoteTerminalOutput(sendInputBytes = sendInputBytes)
    private val client = TerminalEmulatorSessionClient()
    val emulator: TerminalEmulator = TerminalEmulator(
        output,
        initialColumns,
        initialRows,
        TerminalEmulator.DEFAULT_TERMINAL_TRANSCRIPT_ROWS,
        client,
    )
    private val observers = linkedMapOf<String, () -> Unit>()

    fun appendOutput(bytes: ByteArray) {
        val frame = bytes.copyOf()
        postToMain {
            emulator.append(frame, frame.size)
            notifyObservers()
        }
    }

    fun resize(columns: Int, rows: Int) {
        val safeColumns = columns.coerceAtLeast(MinColumns)
        val safeRows = rows.coerceAtLeast(MinRows)
        postToMain {
            emulator.resize(safeColumns, safeRows)
            resizeRemote(safeColumns, safeRows)
            notifyObservers()
        }
    }

    fun visibleText(): String = emulator.getSelectedText(
        0,
        0,
        emulator.mColumns - 1,
        emulator.mRows - 1,
    ).trimEnd()

    fun observe(onChanged: () -> Unit): AutoCloseable {
        val observerId = UUID.randomUUID().toString()
        observers[observerId] = onChanged
        return AutoCloseable {
            observers.remove(observerId)
        }
    }

    fun detach() {
        output.detach()
        observers.clear()
    }

    private fun notifyObservers() {
        observers.values.forEach { it() }
    }

    companion object {
        private const val MinColumns = 2
        private const val MinRows = 2

        private fun mainThreadPoster(): ((() -> Unit) -> Unit) {
            val handler = Handler(Looper.getMainLooper())
            return { action -> handler.post(action) }
        }
    }
}
