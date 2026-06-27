import { createServer } from 'node:net'

export async function findAvailablePort(
  host: string,
  preferredPort = 0,
  errorMessage = 'Failed to allocate embedded server port',
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(preferredPort, host, () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error(errorMessage))
          return
        }
        resolve(address.port)
      })
    })
  })
}

export async function reserveAvailablePort(
  host: string,
  preferredPort: number,
  errorMessage = 'Failed to allocate embedded server port',
): Promise<number> {
  try {
    return await findAvailablePort(host, preferredPort, errorMessage)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'EADDRINUSE') throw error
    return await findAvailablePort(host, 0, errorMessage)
  }
}
