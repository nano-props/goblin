import type { LogEntry } from '#/web/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { cn } from '#/web/lib/cn.ts'
import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'
import { historyRefDisplays, parseHistoryRefs } from '#/web/components/repo-workspace/history-refs.ts'
import type { HistoryRefDisplay } from '#/web/components/repo-workspace/history-refs.ts'
import { CommitHashLink } from '#/web/components/repo-workspace/repo-link-actions.tsx'

interface HistoryCommitNode {
  key: string
  hash: string
  fullHash: string
  refs: HistoryRefDisplay[]
  message: string
  title: string
}

export function HistoryCommitGraph({
  repoId,
  workspaceRuntimeId,
  entries,
}: {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  entries: LogEntry[]
}) {
  const commits = entries.map(historyCommitNode)
  return (
    <ol className="min-w-0 px-2 py-1.5" data-history-commit-graph="">
      {commits.map((commit, index) => (
        <HistoryCommitRow
          key={commit.key}
          repoId={repoId}
          workspaceRuntimeId={workspaceRuntimeId}
          commit={commit}
          position={commitPosition(index, commits.length)}
        />
      ))}
    </ol>
  )
}

export function HistoryCommitGraphSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ol className="min-w-0 px-2 py-1.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-1.5">
          <HistoryCommitRail position={commitPosition(index, rows)} />
          <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-1.5 py-1">
            <Skeleton className="h-4 w-16 shrink-0 rounded-sm" />
            <Skeleton className="h-4 w-3/5 rounded-sm" />
            <div className="col-start-2 flex min-w-0 flex-wrap gap-x-1 gap-y-0.5">
              <Skeleton className="h-[15px] w-24 rounded-sm" />
              <Skeleton className="h-[15px] w-32 rounded-sm" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function HistoryCommitRow({
  repoId,
  workspaceRuntimeId,
  commit,
  position,
}: {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  commit: HistoryCommitNode
  position: CommitPosition
}) {
  return (
    <li
      className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-1.5"
      data-history-commit-row=""
      title={commit.title}
    >
      <HistoryCommitRail position={position} />
      <HistoryCommitContent repoId={repoId} workspaceRuntimeId={workspaceRuntimeId} commit={commit} />
    </li>
  )
}

function HistoryCommitRail({ position }: { position: CommitPosition }) {
  return (
    <div className="relative flex justify-center" aria-hidden="true">
      <span className={cn('absolute top-0 bottom-1/2 w-px bg-border', position.first && 'hidden')} />
      <span className={cn('absolute top-1/2 bottom-0 w-px bg-border', position.last && 'hidden')} />
      <span className="relative mt-[0.7rem] size-1.5 rounded-full border border-primary/70 bg-background shadow-[0_0_0_2px_var(--color-background)]" />
    </div>
  )
}

function HistoryCommitContent({
  repoId,
  workspaceRuntimeId,
  commit,
}: {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  commit: HistoryCommitNode
}) {
  return (
    <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 hover:bg-muted/70">
      <HistoryCommitHash repoId={repoId} workspaceRuntimeId={workspaceRuntimeId} commit={commit} />
      {commit.message ? (
        <span className="min-w-0 truncate text-sm leading-5 text-foreground" data-history-log-message="">
          {commit.message}
        </span>
      ) : null}
      {commit.refs.length > 0 ? <HistoryCommitRefs refs={commit.refs} /> : null}
    </div>
  )
}

function HistoryCommitHash({
  repoId,
  workspaceRuntimeId,
  commit,
}: {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  commit: HistoryCommitNode
}) {
  return (
    <CommitHashLink
      repoId={repoId}
      workspaceRuntimeId={workspaceRuntimeId}
      hash={commit.fullHash}
      shortHash={commit.hash}
      tone="warning"
      className="shrink-0 text-sm font-medium leading-5"
      data-history-log-hash=""
      title={commit.fullHash ? `Open commit ${commit.fullHash}` : undefined}
    />
  )
}

function HistoryCommitRefs({ refs }: { refs: HistoryRefDisplay[] }) {
  return (
    <div className="col-start-2 flex min-w-0 flex-wrap gap-x-1 gap-y-0.5" data-history-log-refs="">
      {refs.map((ref) => (
        <HistoryCommitRefChip key={historyRefKey(ref)} refDisplay={ref} />
      ))}
    </div>
  )
}

function HistoryCommitRefChip({ refDisplay }: { refDisplay: HistoryRefDisplay }) {
  if (refDisplay.kind === 'mergedRemote') return <MergedRemoteRefChip refDisplay={refDisplay} />
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center overflow-hidden rounded-sm border px-1 py-0 font-mono text-[11px] leading-[15px]',
        STATUS_TONE_CHIP_CLASS[refDisplay.tone],
      )}
      data-history-log-ref-token={refDisplay.refName}
      title={refDisplay.refName}
    >
      <span className="min-w-0 truncate">{refDisplay.refName}</span>
    </span>
  )
}

function MergedRemoteRefChip({ refDisplay }: { refDisplay: Extract<HistoryRefDisplay, { kind: 'mergedRemote' }> }) {
  const remoteLabel = mergedRemoteLabel(refDisplay.remoteNames)
  const title = [refDisplay.refName, ...refDisplay.remoteRefs].join(', ')
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center overflow-hidden rounded-sm border px-1 py-0 font-mono text-[11px] leading-[15px]',
        STATUS_TONE_CHIP_CLASS[refDisplay.tone],
      )}
      data-history-log-ref-token={refDisplay.refName}
      data-history-log-ref-remotes={refDisplay.remoteNames.join(',')}
      title={title}
    >
      <span className="min-w-0 truncate">{refDisplay.label}</span>
      {remoteLabel ? <span className="shrink-0">&nbsp;· {remoteLabel}</span> : null}
    </span>
  )
}

function mergedRemoteLabel(remoteNames: string[]): string {
  const [firstRemote, ...rest] = remoteNames
  if (!firstRemote) return ''
  return rest.length === 0 ? firstRemote : `${firstRemote} +${rest.length}`
}

interface CommitPosition {
  first: boolean
  last: boolean
}

function commitPosition(index: number, count: number): CommitPosition {
  return { first: index === 0, last: index === count - 1 }
}

function historyCommitNode(entry: LogEntry, index: number): HistoryCommitNode {
  const fullHash = entry.hash || entry.shortHash
  const hash = entry.shortHash || entry.hash.slice(0, 7)
  return {
    key: entry.hash || `${entry.shortHash}-${index}`,
    hash,
    fullHash,
    refs: historyRefDisplays(parseHistoryRefs(entry.refs)),
    message: entry.message,
    title: historyLogLine(entry),
  }
}

function historyRefKey(refDisplay: HistoryRefDisplay): string {
  return refDisplay.kind === 'mergedRemote'
    ? `${refDisplay.refName}:${refDisplay.remoteRefs.join('|')}`
    : refDisplay.refName
}

function historyLogLine(entry: LogEntry): string {
  const hash = entry.shortHash || entry.hash
  const refs = entry.refs.trim()
  return [hash, refs ? `(${refs})` : '', entry.message].filter(Boolean).join(' ')
}
