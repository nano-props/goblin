import { terminalRealtimeWireValue, type TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'
import {
  REALTIME_HEARTBEAT_DEADLINE_MS,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  RealtimeBroker,
  type RealtimeClientPresenceChange,
  type RealtimeBrokerOptions,
  type RealtimeSocket,
} from '#/server/realtime/realtime-broker.ts'

export const HEARTBEAT_INTERVAL_MS = REALTIME_HEARTBEAT_INTERVAL_MS
export const HEARTBEAT_DEADLINE_MS = REALTIME_HEARTBEAT_DEADLINE_MS

export type TerminalRealtimeSocket = RealtimeSocket
export type TerminalClientPresenceChange = RealtimeClientPresenceChange

export class TerminalRealtimeBroker extends RealtimeBroker<TerminalRealtimeMessage> {
  constructor(options: RealtimeBrokerOptions) {
    super({
      heartbeatTimeoutReason: 'terminal heartbeat timeout',
      ...options,
    })
  }

  protected override serializeMessage(message: TerminalRealtimeMessage): string {
    return JSON.stringify(terminalRealtimeWireValue(message))
  }
}
