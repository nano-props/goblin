// Vitest restores all stubbed globals together; browser facades need cleanup
// without removing independently owned fetch or animation mocks.
import { afterEach } from 'vitest'

type BrowserGlobal = 'window' | 'document'
const originalDescriptors = new Map<BrowserGlobal, PropertyDescriptor | undefined>()

export function stubBrowserGlobal(name: BrowserGlobal, value: unknown): void {
  if (!originalDescriptors.has(name)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}

afterEach(() => {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  originalDescriptors.clear()
})
