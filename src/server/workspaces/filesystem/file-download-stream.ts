import type { Readable } from 'node:stream'

export interface NodeReadableStart {
  iterator: AsyncIterator<unknown>
  firstChunk?: Uint8Array
}

export function nodeReadableStream(
  stream: Readable,
  options: {
    start?: NodeReadableStart
    cancel?: () => void
    complete?: () => Promise<void>
  } = {},
): ReadableStream<Uint8Array> {
  const iterator = options.start?.iterator ?? stream[Symbol.asyncIterator]()
  const cancel = options.cancel ?? (() => stream.destroy())
  const complete = options.complete ?? (async () => {})
  let firstChunk = options.start?.firstChunk
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (firstChunk) {
          controller.enqueue(firstChunk)
          firstChunk = undefined
          return
        }
        const chunk = await iterator.next()
        if (chunk.done) {
          await complete()
          controller.close()
          return
        }
        controller.enqueue(bytesFromReadableChunk(chunk.value))
      } catch (error) {
        cancel()
        controller.error(error)
      }
    },
    cancel,
  })
}

export function bytesFromReadableChunk(chunk: unknown): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  throw new Error('error.file-download-protocol-invalid')
}
