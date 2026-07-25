export type NativeHostTerminationSignal = 'SIGINT' | 'SIGTERM'

interface NativeHostTerminationSignalSource {
  once(signal: NativeHostTerminationSignal, listener: () => void): unknown
}

const NATIVE_HOST_TERMINATION_SIGNALS: readonly NativeHostTerminationSignal[] = ['SIGINT', 'SIGTERM']

/** Routes process termination through Electron's single application-quit transaction. */
export function registerNativeHostTerminationSignals(
  requestQuit: () => void,
  source: NativeHostTerminationSignalSource = process,
): void {
  let terminationRequested = false
  const handleTermination = () => {
    if (terminationRequested) return
    terminationRequested = true
    requestQuit()
  }
  for (const signal of NATIVE_HOST_TERMINATION_SIGNALS) source.once(signal, handleTermination)
}
