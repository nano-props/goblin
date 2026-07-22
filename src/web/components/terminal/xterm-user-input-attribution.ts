import type { Terminal as XTermTerminal } from '@xterm/xterm'

interface XtermCoreUserInputService {
  onUserInput: (listener: () => void) => { dispose: () => void }
}

export function subscribeToXtermUserInput(
  term: XTermTerminal,
  listener: () => void,
): { dispose: () => void } {
  // xterm 6 has no public event that distinguishes user input from
  // emulator-generated onData. Keep the pinned-version private boundary here.
  const coreService = (term as unknown as { _core?: { coreService?: { onUserInput?: unknown } } })._core?.coreService
  const onUserInput = coreService?.onUserInput
  if (!coreService || typeof onUserInput !== 'function') {
    throw new Error('xterm user-input attribution is unavailable')
  }
  const disposable = onUserInput.call(coreService, listener)
  if (!disposable || typeof disposable.dispose !== 'function') {
    throw new Error('xterm user-input attribution returned an invalid subscription')
  }
  return disposable
}
