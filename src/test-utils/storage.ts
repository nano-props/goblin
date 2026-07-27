// Vitest has no scoped API for making a setup-owned Storage binding unavailable.
export async function withBrowserStorageUnavailable<T>(
  name: 'localStorage' | 'sessionStorage',
  run: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, value: undefined })
  try {
    return await run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
}
