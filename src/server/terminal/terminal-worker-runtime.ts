import type { ServerTerminalSocket } from '#/server/terminal/terminal-host.ts'
import type {
  TerminalWorkerActionRequest,
  TerminalWorkerFailureMessage,
  TerminalWorkerMessage,
  TerminalWorkerRequest,
  TerminalWorkerSuccessMessage,
} from '#/server/terminal/terminal-worker-protocol.ts'
import type { TerminalFacade } from '#/server/terminal/terminal-facade.ts'
import { serverLogger } from '#/server/logger.ts'

const terminalWorkerRuntimeLogger = serverLogger.child({ module: 'terminal-worker-runtime' })

export interface TerminalWorkerRuntimeOptions {
  service: TerminalFacade
  emit(message: TerminalWorkerMessage): void
  exit(code: number): void
}

export class TerminalWorkerRuntime {
  private readonly options: TerminalWorkerRuntimeOptions
  private readonly sockets = new Map<string, ServerTerminalSocket>()

  constructor(options: TerminalWorkerRuntimeOptions) {
    this.options = options
  }

  async handleMessage(message: TerminalWorkerRequest | null | undefined): Promise<void> {
    if (!message || typeof message !== 'object') return
    if (message.type === 'socket-register') {
      this.registerProxySocket(message.socketId, message.clientId, message.attachmentId)
      return
    }
    if (message.type === 'socket-unregister') {
      this.unregisterProxySocket(message.socketId, message.clientId, message.attachmentId)
      return
    }
    if (message.type === 'shutdown') {
      this.options.service.shutdown()
      this.options.exit(0)
      return
    }
    await this.handleRequest(message)
  }

  private async handleRequest(message: TerminalWorkerActionRequest): Promise<void> {
    try {
      const payload = await this.dispatchRequest(message)
      this.options.emit({ type: 'response', requestId: message.requestId, ok: true, payload } satisfies TerminalWorkerSuccessMessage)
    } catch (error) {
      terminalWorkerRuntimeLogger.warn(
        {
          action: message.action,
          clientId: message.clientId,
          requestId: message.requestId,
          err: error,
        },
        'terminal worker request failed',
      )
      this.options.emit({
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies TerminalWorkerFailureMessage)
    }
  }

  private async dispatchRequest(message: TerminalWorkerActionRequest) {
    switch (message.action) {
      case 'attach':
        return await this.options.service.attach(message.clientId, message.input)
      case 'restart':
        return await this.options.service.restart(message.clientId, message.input)
      case 'write':
        return await this.options.service.write(message.clientId, message.input)
      case 'resize':
        return await this.options.service.resize(message.clientId, message.input)
      case 'takeover':
        return await this.options.service.takeover(message.clientId, message.input)
      case 'close':
        return await this.options.service.close(message.clientId, message.input)
      case 'notify-bell':
        return await this.options.service.notifyBell(message.clientId, message.input)
      case 'list-sessions':
        return await this.options.service.listSessions(message.clientId, message.input)
      case 'create':
        return await this.options.service.create(message.clientId, message.input)
      case 'prune':
        return await this.options.service.prune(message.clientId, message.input)
      case 'session-snapshot':
        return await this.options.service.getSessionSnapshot(message.clientId, message.input)
    }
  }

  private registerProxySocket(socketId: string, clientId: string, attachmentId: string): void {
    const socket: ServerTerminalSocket = {
      send: (payload) => {
        this.options.emit({ type: 'socket-send', socketId, payload })
      },
      close: (code, reason) => {
        this.options.emit({ type: 'socket-close', socketId, code, reason })
      },
    }
    this.sockets.set(socketId, socket)
    this.options.service.registerSocket(clientId, attachmentId, socket)
  }

  private unregisterProxySocket(socketId: string, clientId: string, attachmentId: string): void {
    const socket = this.sockets.get(socketId)
    if (!socket) return
    this.sockets.delete(socketId)
    this.options.service.unregisterSocket(clientId, attachmentId, socket)
  }
}
