import { queryOptions, useQuery } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  closeAgentSession,
  closeAgentSessionsForWorktree,
  getAgentSession,
  listAgentSessions,
  sendAgentMessage,
} from '#/web/agent-client.ts'
import type {
  AgentCloseInput,
  AgentGetInput,
  AgentSendMessageInput,
  AgentSessionDetail,
  AgentSessionSummary,
} from '#/shared/agent-types.ts'

export function agentSessionsQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['agent-sessions', repoRoot, repoInstanceId] as const
}

export function agentSessionDetailQueryKey(repoRoot: string, repoInstanceId: string, agentSessionId: string) {
  return ['agent-session-detail', repoRoot, repoInstanceId, agentSessionId] as const
}

export function agentSessionsQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: agentSessionsQueryKey(repoRoot, repoInstanceId),
    queryFn: async () => await listAgentSessions({ repoRoot, repoInstanceId }),
    staleTime: 3_000,
  })
}

export function agentSessionDetailQueryOptions(input: AgentGetInput) {
  return queryOptions({
    queryKey: agentSessionDetailQueryKey(input.repoRoot, input.repoInstanceId, input.agentSessionId),
    queryFn: async () => await getAgentSession(input),
    staleTime: 1_000,
  })
}

export function useAgentSessionsQuery(repoRoot: string, repoInstanceId: string) {
  return useQuery(agentSessionsQueryOptions(repoRoot, repoInstanceId))
}

export function useAgentSessionDetailQuery(input: AgentGetInput | null) {
  return useQuery({
    ...agentSessionDetailQueryOptions(
      input ?? { repoRoot: '', repoInstanceId: '', agentSessionId: '' },
    ),
    enabled: !!input,
  })
}

export async function refreshAgentSessions(repoRoot: string, repoInstanceId: string): Promise<void> {
  await primaryWindowQueryClient.invalidateQueries({ queryKey: agentSessionsQueryKey(repoRoot, repoInstanceId) })
}

export async function setAgentSessionDetail(detail: AgentSessionDetail): Promise<void> {
  primaryWindowQueryClient.setQueryData(
    agentSessionDetailQueryKey(detail.repoRoot, detail.repoInstanceId, detail.agentSessionId),
    detail,
  )
  await refreshAgentSessions(detail.repoRoot, detail.repoInstanceId)
}

export function readAgentSessionSummaries(repoRoot: string, repoInstanceId: string): AgentSessionSummary[] {
  return primaryWindowQueryClient.getQueryData(agentSessionsQueryKey(repoRoot, repoInstanceId)) ?? []
}

export async function sendAgentMessageAndUpdate(input: AgentSendMessageInput): Promise<boolean> {
  const result = await sendAgentMessage(input)
  if (!result.ok) return false
  await setAgentSessionDetail(result.session)
  return true
}

export async function closeAgentSessionAndRefresh(input: AgentCloseInput): Promise<boolean> {
  const ok = await closeAgentSession(input)
  await primaryWindowQueryClient.invalidateQueries({
    queryKey: agentSessionDetailQueryKey(input.repoRoot, input.repoInstanceId, input.agentSessionId),
  })
  await refreshAgentSessions(input.repoRoot, input.repoInstanceId)
  return ok
}

export async function closeAgentSessionsForWorktreeAndRefresh(input: {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string
}): Promise<boolean> {
  const ok = await closeAgentSessionsForWorktree(input)
  await refreshAgentSessions(input.repoRoot, input.repoInstanceId)
  return ok
}
