package dev.goblin.android.terminals

class TerminalOutputFilter {
    private var pendingControlSequence: String = ""

    fun append(value: String): String {
        if (value.isEmpty()) return ""

        val input = pendingControlSequence + value
        pendingControlSequence = ""

        val output = StringBuilder(input.length)
        var index = 0
        while (index < input.length) {
            when (input[index]) {
                Escape -> {
                    val nextIndex = consumeEscape(input, index)
                    if (nextIndex == null) {
                        pendingControlSequence = input.substring(index)
                        index = input.length
                    } else {
                        index = nextIndex
                    }
                }
                Csi -> {
                    val nextIndex = consumeCsi(input, index + 1)
                    if (nextIndex == null) {
                        pendingControlSequence = input.substring(index)
                        index = input.length
                    } else {
                        index = nextIndex
                    }
                }
                Osc -> {
                    val nextIndex = consumeStringControl(input, index + 1)
                    if (nextIndex == null) {
                        pendingControlSequence = input.substring(index)
                        index = input.length
                    } else {
                        index = nextIndex
                    }
                }
                else -> {
                    output.append(input[index])
                    index += 1
                }
            }
        }

        return rawBracketedPasteRegex.replace(output.toString(), "")
    }

    fun reset() {
        pendingControlSequence = ""
    }

    private fun consumeEscape(input: String, startIndex: Int): Int? {
        val selectorIndex = startIndex + 1
        if (selectorIndex >= input.length) return null
        return when (input[selectorIndex]) {
            '[' -> consumeCsi(input, selectorIndex + 1)
            ']' -> consumeStringControl(input, selectorIndex + 1)
            'P', '^', '_', 'X' -> consumeStringControl(input, selectorIndex + 1)
            else -> selectorIndex + 1
        }
    }

    private fun consumeCsi(input: String, startIndex: Int): Int? {
        var index = startIndex
        while (index < input.length) {
            if (input[index].code in CsiFinalByteRange) return index + 1
            index += 1
        }
        return null
    }

    private fun consumeStringControl(input: String, startIndex: Int): Int? {
        var index = startIndex
        while (index < input.length) {
            if (input[index] == Bell) return index + 1
            if (input[index] == Escape) {
                val terminatorIndex = index + 1
                if (terminatorIndex >= input.length) return null
                if (input[terminatorIndex] == '\\') return terminatorIndex + 1
            }
            index += 1
        }
        return null
    }

    private companion object {
        const val Escape = '\u001B'
        const val Bell = '\u0007'
        const val Csi = '\u009B'
        const val Osc = '\u009D'
        val CsiFinalByteRange = 0x40..0x7E
        val rawBracketedPasteRegex = Regex("\\[\\?2004\\d*[hl]\\]?")
    }
}
