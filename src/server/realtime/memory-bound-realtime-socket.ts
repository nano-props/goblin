import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerAppRealtimeSocket } from '#/server/realtime/app-realtime-host.ts'

export const MAX_APP_REALTIME_SEND_BACKLOG_BYTES = 16 * 1024 * 1024

const SEND_CAPACITY_ERROR = 'app realtime pending send capacity exceeded'

/**
 * Bounds bytes already waiting in the raw WebSocket sender before admitting
 * another atomic message. This neither queues nor delays application sends:
 * a slow peer gets disconnected on the next send after crossing the limit.
 */
export class MemoryBoundRealtimeSocket implements RealtimeSocket {
  private active = true
  private terminated = false
  private readonly socket: ServerAppRealtimeSocket

  constructor(socket: ServerAppRealtimeSocket) {
    this.socket = socket
  }

  send(data: string): void {
    if (!this.active) throw new Error('app realtime socket is closed')
    if (this.socket.bufferedAmount > MAX_APP_REALTIME_SEND_BACKLOG_BYTES) {
      this.rejectPendingSend()
    }
    try {
      this.socket.send(data)
    } catch (error) {
      this.terminate()
      throw error
    }
  }

  close(code?: number, reason?: string): void {
    if (!this.active) return
    this.active = false
    try {
      this.socket.close(code, reason)
    } catch (error) {
      this.terminate()
      throw error
    }
  }

  forceClose(): void {
    this.terminate()
  }

  private rejectPendingSend(): never {
    this.terminate()
    throw new Error(SEND_CAPACITY_ERROR)
  }

  private terminate(): void {
    if (this.terminated) return
    this.active = false
    this.terminated = true
    this.socket.terminate()
  }
}
