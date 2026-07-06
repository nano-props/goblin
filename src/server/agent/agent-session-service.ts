import { createOpaqueId } from '#/shared/opaque-id.ts'
import { isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  AgentAdapterKind,
  AgentCloseInput,
  AgentCreateInput,
  AgentCreateResult,
  AgentGetInput,
  AgentListInput,
  AgentMessage,
  AgentMutationResult,
  AgentSendMessageInput,
  AgentSendMessageResult,
  AgentSessionBase,
  AgentSessionDetail,
  AgentSessionPhase,
  AgentSessionSummary,
} from '#/shared/agent-types.ts'
import type { AgentAdapter } from '#/server/agent/agent-adapter.ts'
import { BuiltinAgentAdapter } from '#/server/agent/builtin-agent-adapter.ts'
import { isCurrentRepoRuntimeInstance } from '#/server/modules/repo-runtime-instances.ts'

interface AgentSessionRecord extends AgentSessionDetail {
  userId: string
}

export interface AgentSessionServiceOptions {
  adapters?: readonly AgentAdapter[]
}

export interface AgentSessionService {
  create(userId: string, input: AgentCreateInput): Promise<AgentCreateResult>
  list(userId: string, input: AgentListInput): Promise<AgentSessionSummary[]>
  get(userId: string, input: AgentGetInput): Promise<AgentSessionDetail | null>
  sendMessage(userId: string, input: AgentSendMessageInput): Promise<AgentSendMessageResult>
  close(userId: string, input: AgentCloseInput): Promise<AgentMutationResult>
  closeForWorktree(
    userId: string,
    input: { repoRoot: string; repoInstanceId: string; worktreePath: string },
  ): Promise<AgentMutationResult>
  shutdown(): void
}

export function createAgentSessionService(options: AgentSessionServiceOptions = {}): AgentSessionService {
  const adapters = new Map<AgentAdapterKind, AgentAdapter>()
  for (const adapter of [new BuiltinAgentAdapter(), ...(options.adapters ?? [])]) {
    adapters.set(adapter.kind, adapter)
  }
  const sessionsByUser = new Map<string, Map<string, AgentSessionRecord>>()

  return {
    async create(userId, input) {
      const invalid = invalidBaseMessage(input)
      if (invalid) return { ok: false, message: invalid }
      if (!isCurrentRepoRuntimeInstance(userId, input.repoRoot, input.repoInstanceId)) {
        return { ok: false, message: 'error.repo-instance-stale' }
      }
      const adapterKind = input.adapterKind ?? 'builtin'
      const adapter = adapters.get(adapterKind)
      if (!adapter) return { ok: false, message: 'agent.adapter-unavailable' }
      const now = Date.now()
      const session: AgentSessionRecord = {
        type: 'agent',
        userId,
        agentSessionId: createOpaqueId('agent-session'),
        repoRoot: input.repoRoot,
        repoInstanceId: input.repoInstanceId,
        branch: input.branch,
        worktreePath: input.worktreePath,
        title: normalizedTitle(input.title, input.branch),
        adapterKind,
        phase: 'idle',
        messageCount: 0,
        updatedAt: now,
        messages: [],
      }
      sessionsForUser(userId).set(session.agentSessionId, session)
      return { ok: true, session: publicDetail(session) }
    },

    async list(userId, input) {
      if (!isValidRepoLocator(input.repoRoot)) return []
      if (!isCurrentRepoRuntimeInstance(userId, input.repoRoot, input.repoInstanceId)) return []
      return Array.from(sessionsForUser(userId).values())
        .filter((session) => session.repoRoot === input.repoRoot && session.repoInstanceId === input.repoInstanceId)
        .map(publicSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async get(userId, input) {
      if (!isValidRepoLocator(input.repoRoot)) return null
      if (!isCurrentRepoRuntimeInstance(userId, input.repoRoot, input.repoInstanceId)) return null
      const session = sessionsForUser(userId).get(input.agentSessionId)
      if (!session || !matchesRepoInput(session, input)) return null
      return publicDetail(session)
    },

    async sendMessage(userId, input) {
      const session = sessionsForUser(userId).get(input.agentSessionId)
      if (!session || !matchesRepoInput(session, input)) return { ok: false, message: 'agent.session-not-found' }
      if (!isCurrentRepoRuntimeInstance(userId, session.repoRoot, session.repoInstanceId)) {
        return { ok: false, message: 'error.repo-instance-stale' }
      }
      const content = input.content.trim()
      if (!content) return { ok: false, message: 'agent.message-empty' }
      const adapter = adapters.get(session.adapterKind)
      if (!adapter) return { ok: false, message: 'agent.adapter-unavailable' }

      const now = Date.now()
      session.messages.push(message('user', content, 'complete', now))
      session.phase = 'running'
      session.updatedAt = now
      refreshMessageCount(session)
      try {
        const result = await adapter.sendMessage({
          session: adapterContext(session),
          messages: session.messages,
          content,
        })
        session.messages.push(message('assistant', result.content, 'complete', Date.now()))
        session.phase = 'idle'
      } catch (err) {
        session.phase = 'error'
        session.messages.push(
          message('assistant', err instanceof Error ? err.message : 'agent.message-failed', 'error', Date.now()),
        )
      }
      session.updatedAt = Date.now()
      refreshMessageCount(session)
      return { ok: true, session: publicDetail(session) }
    },

    async close(userId, input) {
      const sessions = sessionsForUser(userId)
      const session = sessions.get(input.agentSessionId)
      if (!session || !matchesRepoInput(session, input)) return false
      await closeRecord(session)
      sessions.delete(input.agentSessionId)
      return true
    },

    async closeForWorktree(userId, input) {
      const sessions = sessionsForUser(userId)
      const toClose = Array.from(sessions.values()).filter(
        (session) =>
          session.repoRoot === input.repoRoot &&
          session.repoInstanceId === input.repoInstanceId &&
          session.worktreePath === input.worktreePath,
      )
      for (const session of toClose) {
        await closeRecord(session)
        sessions.delete(session.agentSessionId)
      }
      return true
    },

    shutdown() {
      for (const sessions of sessionsByUser.values()) {
        for (const session of sessions.values()) {
          void closeRecord(session)
        }
      }
      sessionsByUser.clear()
    },
  }

  function sessionsForUser(userId: string): Map<string, AgentSessionRecord> {
    let sessions = sessionsByUser.get(userId)
    if (!sessions) {
      sessions = new Map()
      sessionsByUser.set(userId, sessions)
    }
    return sessions
  }

  async function closeRecord(session: AgentSessionRecord): Promise<void> {
    session.phase = 'closed'
    const adapter = adapters.get(session.adapterKind)
    await adapter?.close?.(adapterContext(session))
  }
}

function invalidBaseMessage(input: AgentSessionBase): string | null {
  if (!isValidRepoLocator(input.repoRoot)) return 'error.invalid-arguments'
  if (!isValidBranch(input.branch)) return 'error.invalid-arguments'
  if (!isValidCwd(input.worktreePath)) return 'error.invalid-arguments'
  return null
}

function normalizedTitle(title: string | undefined, branch: string): string {
  const trimmed = title?.trim()
  return trimmed ? trimmed.slice(0, 80) : branch
}

function message(
  role: AgentMessage['role'],
  content: string,
  status: AgentMessage['status'],
  createdAt: number,
): AgentMessage {
  return {
    id: createOpaqueId('agent-message'),
    role,
    content,
    status,
    createdAt,
  }
}

function publicSummary(session: AgentSessionRecord): AgentSessionSummary {
  return {
    type: 'agent',
    agentSessionId: session.agentSessionId,
    repoRoot: session.repoRoot,
    repoInstanceId: session.repoInstanceId,
    branch: session.branch,
    worktreePath: session.worktreePath,
    title: session.title,
    adapterKind: session.adapterKind,
    phase: session.phase,
    messageCount: session.messageCount,
    updatedAt: session.updatedAt,
  }
}

function publicDetail(session: AgentSessionRecord): AgentSessionDetail {
  return {
    ...publicSummary(session),
    messages: session.messages.map((entry) => ({ ...entry })),
  }
}

function matchesRepoInput(
  session: AgentSessionRecord,
  input: { repoRoot: string; repoInstanceId: string },
): boolean {
  return session.repoRoot === input.repoRoot && session.repoInstanceId === input.repoInstanceId
}

function adapterContext(session: AgentSessionRecord): AgentSessionBase & { agentSessionId: string } {
  return {
    agentSessionId: session.agentSessionId,
    repoRoot: session.repoRoot,
    repoInstanceId: session.repoInstanceId,
    branch: session.branch,
    worktreePath: session.worktreePath,
  }
}

function refreshMessageCount(session: AgentSessionRecord): void {
  session.messageCount = session.messages.length
}
