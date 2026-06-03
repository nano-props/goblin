import { afterEach, describe, expect, test } from 'vitest'
import { createServer } from 'node:net'
import { DEFAULT_EMBEDDED_SERVER_PORT, parseServerPort, reserveEmbeddedServerPort } from '#/main/server-manager.ts'

const openServers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function reserveTestPort(): Promise<number> {
  const server = createServer()
  openServers.push(server)
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to reserve test port'))
        return
      }
      resolve(address.port)
    })
  })
}

describe('embedded server port selection', () => {
  test('parses configured ports and falls back to the default port for invalid values', () => {
    expect(parseServerPort('32123')).toBe(32123)
    expect(parseServerPort(undefined)).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
    expect(parseServerPort('0')).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
    expect(parseServerPort('abc')).toBe(DEFAULT_EMBEDDED_SERVER_PORT)
  })

  test('prefers the fixed port when it is available', async () => {
    const preferredPort = await reserveEmbeddedServerPort('127.0.0.1', 0)

    await expect(reserveEmbeddedServerPort('127.0.0.1', preferredPort)).resolves.toBe(preferredPort)
  })

  test('falls back to a random port when the fixed port is already occupied', async () => {
    const preferredPort = await reserveTestPort()

    const port = await reserveEmbeddedServerPort('127.0.0.1', preferredPort)

    expect(port).not.toBe(preferredPort)
    expect(port).toBeGreaterThan(0)
  })
})
