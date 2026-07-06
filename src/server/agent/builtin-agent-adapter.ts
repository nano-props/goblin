import type { AgentAdapter, AgentAdapterSendInput, AgentAdapterSendResult } from '#/server/agent/agent-adapter.ts'

export class BuiltinAgentAdapter implements AgentAdapter {
  readonly kind = 'builtin' as const

  async sendMessage(input: AgentAdapterSendInput): Promise<AgentAdapterSendResult> {
    const trimmed = input.content.trim()
    const subject = trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed
    return {
      content: `Captured request for ${input.session.branch}: ${subject || 'empty message'}. No coding adapter is configured for this session yet.`,
    }
  }
}
