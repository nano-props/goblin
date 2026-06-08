package dev.goblin.android.ui.screens.terminals

import android.view.KeyEvent
import com.termux.terminal.KeyHandler

internal fun terminalTextBytes(text: CharSequence): ByteArray =
    buildString {
        text.forEach { char ->
            append(if (char == '\n') '\r' else char)
        }
    }.toByteArray(Charsets.UTF_8)

internal fun terminalKeyBytes(
    keyCode: Int,
    action: Int = KeyEvent.ACTION_DOWN,
    ctrlPressed: Boolean = false,
    altPressed: Boolean = false,
    shiftPressed: Boolean = false,
    cursorKeysApplicationMode: Boolean = false,
    keypadApplicationMode: Boolean = false,
): ByteArray? {
    if (action != KeyEvent.ACTION_DOWN) return null

    val control = terminalControlInput(
        keyCode = keyCode,
        ctrlPressed = ctrlPressed,
        action = action,
    )
    if (control != null) return control.toByteArray(Charsets.UTF_8)

    var keyMode = 0
    if (ctrlPressed) keyMode = keyMode or KeyHandler.KEYMOD_CTRL
    if (altPressed) keyMode = keyMode or KeyHandler.KEYMOD_ALT
    if (shiftPressed) keyMode = keyMode or KeyHandler.KEYMOD_SHIFT

    return KeyHandler.getCode(
        keyCode,
        keyMode,
        cursorKeysApplicationMode,
        keypadApplicationMode,
    )?.toByteArray(Charsets.UTF_8)
}
