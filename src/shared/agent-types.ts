export type AgentSessionPhase = 'idle' | 'running' | 'error' | 'closed'
export type AgentMessageRole = 'user' | 'assistant' | 'system'
export type AgentMessageStatus = 'complete' | 'running' | 'error'
export type AgentAdapterKind = 'builtin' | 'acp'

export interface AgentSessionBase {
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
}

export interface AgentSessionSummary {
  type: 'agent'
  agentSessionId: string
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
  title: string
  adapterKind: AgentAdapterKind
  phase: AgentSessionPhase
  messageCount: number
  updatedAt: number
}

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  status: AgentMessageStatus
  createdAt: number
}

export interface AgentSessionDetail extends AgentSessionSummary {
  messages: AgentMessage[]
}

export type AgentCreateResult =
  | {
      ok: true
      session: AgentSessionDetail
    }
  | { ok: false; message: string }

export type AgentSendMessageResult =
  | {
      ok: true
      session: AgentSessionDetail
    }
  | { ok: false; message: string }

export interface AgentCreateInput extends AgentSessionBase {
  title?: string
  adapterKind?: AgentAdapterKind
}

export interface AgentListInput {
  repoRoot: string
  repoInstanceId: string
}

export interface AgentGetInput {
  repoRoot: string
  repoInstanceId: string
  agentSessionId: string
}

export interface AgentSendMessageInput extends AgentGetInput {
  content: string
}

export interface AgentCloseInput extends AgentGetInput {}

export type AgentMutationResult = boolean
