import type { AgentAdapterKind, AgentMessage, AgentSessionBase } from '#/shared/agent-types.ts'

export interface AgentAdapterSessionContext extends AgentSessionBase {
  agentSessionId: string
}

export interface AgentAdapterSendInput {
  session: AgentAdapterSessionContext
  messages: readonly AgentMessage[]
  content: string
}

export interface AgentAdapterSendResult {
  content: string
}

export interface AgentAdapter {
  readonly kind: AgentAdapterKind
  sendMessage(input: AgentAdapterSendInput): Promise<AgentAdapterSendResult>
  close?(session: AgentAdapterSessionContext): Promise<void> | void
}
