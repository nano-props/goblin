import { postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  AgentCloseInput,
  AgentCreateInput,
  AgentCreateResult,
  AgentGetInput,
  AgentListInput,
  AgentMessage,
  AgentMutationResult,
  AgentSendMessageInput,
  AgentSendMessageResult,
  AgentSessionDetail,
  AgentSessionSummary,
} from '#/shared/agent-types.ts'

export async function createAgentSession(input: AgentCreateInput): Promise<AgentCreateResult> {
  return await postServerJson('/api/agent/create', input)
}

export async function listAgentSessions(input: AgentListInput): Promise<AgentSessionSummary[]> {
  return normalizeAgentSessionSummaries(await postServerJson('/api/agent/list', input))
}

export async function getAgentSession(input: AgentGetInput): Promise<AgentSessionDetail> {
  return normalizeAgentSessionDetail(await postServerJson('/api/agent/get', input))
}

export async function sendAgentMessage(input: AgentSendMessageInput): Promise<AgentSendMessageResult> {
  return await postServerJson('/api/agent/send-message', input)
}

export async function closeAgentSession(input: AgentCloseInput): Promise<AgentMutationResult> {
  return await postServerJson('/api/agent/close', input)
}

export async function closeAgentSessionsForWorktree(input: {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string
}): Promise<AgentMutationResult> {
  return await postServerJson('/api/agent/close-worktree', input)
}

function normalizeAgentSessionSummaries(value: unknown): AgentSessionSummary[] {
  return Array.isArray(value) ? value.flatMap((entry) => (isAgentSessionSummary(entry) ? [entry] : [])) : []
}

function normalizeAgentSessionDetail(value: unknown): AgentSessionDetail {
  if (isAgentSessionDetail(value)) return value
  throw new Error('Agent response failed: invalid session detail')
}

function isAgentSessionSummary(value: unknown): value is AgentSessionSummary {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<AgentSessionSummary>
  return (
    session.type === 'agent' &&
    typeof session.agentSessionId === 'string' &&
    typeof session.repoRoot === 'string' &&
    typeof session.repoInstanceId === 'string' &&
    typeof session.branch === 'string' &&
    typeof session.worktreePath === 'string' &&
    typeof session.title === 'string' &&
    (session.adapterKind === 'builtin' || session.adapterKind === 'acp') &&
    (session.phase === 'idle' || session.phase === 'running' || session.phase === 'error' || session.phase === 'closed') &&
    typeof session.messageCount === 'number' &&
    typeof session.updatedAt === 'number'
  )
}

function isAgentSessionDetail(value: unknown): value is AgentSessionDetail {
  if (!isAgentSessionSummary(value)) return false
  const session = value as Partial<AgentSessionDetail>
  return Array.isArray(session.messages) && session.messages.every(isAgentMessage)
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<AgentMessage>
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
    typeof message.content === 'string' &&
    (message.status === 'complete' || message.status === 'running' || message.status === 'error') &&
    typeof message.createdAt === 'number'
  )
}
