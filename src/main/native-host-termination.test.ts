import { describe, expect, test, vi } from 'vitest'
import {
  registerNativeHostTerminationSignals,
  type NativeHostTerminationSignal,
} from '#/main/native-host-termination.ts'

describe('native host termination', () => {
  test.each(['SIGINT', 'SIGTERM'] as const)(
    'routes %s through the application quit transaction exactly once',
    (signal) => {
      const listeners = new Map<NativeHostTerminationSignal, () => void>()
      const source = {
        once: vi.fn((name: NativeHostTerminationSignal, listener: () => void) => listeners.set(name, listener)),
      }
      const requestQuit = vi.fn()
      registerNativeHostTerminationSignals(requestQuit, source)

      emit(signal)
      emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')

      expect(requestQuit).toHaveBeenCalledOnce()
      expect(listeners.size).toBe(0)
      function emit(name: NativeHostTerminationSignal): void {
        const listener = listeners.get(name)
        listeners.delete(name)
        listener?.()
      }
    },
  )
})
