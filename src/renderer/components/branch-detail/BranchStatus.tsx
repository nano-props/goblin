import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  RadioTower,
  RefreshCw,
} from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import { tildify } from '#/renderer/lib/paths.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'

interface Props {
  detail: SelectedBranchDetail
}

type Tone = 'neutral' | 'success' | 'warning' | 'brand'

const COPY_FEEDBACK_MS = 1200
const ROW_CLASS = 'grid h-9 grid-cols-[1.25rem_5.75rem_minmax(0,1fr)] items-center gap-3 px-4'
const ROW_ICON_CLASS = 'flex size-5 items-center justify-center'
const ROW_LABEL_CLASS = 'truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const ROW_VALUE_CLASS = 'min-w-0 truncate text-sm text-foreground'
const ROW_DETAIL_CLASS = 'min-w-0 truncate text-xs text-muted-foreground'
const MONO_VALUE_CLASS = 'font-mono'
const INLINE_TRUNCATE_CLASS = 'block min-w-0 flex-1 truncate'
const TONE_TEXT_CLASS: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  brand: 'text-brand-text',
}
const TONE_SURFACE_CLASS: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-success/25 bg-success-surface text-success',
  warning: 'border-warning/25 bg-warning-surface text-warning',
  brand: 'border-brand/25 bg-brand-surface text-brand-text',
}

type StatusChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: Tone
}

const StatusChip = forwardRef<HTMLSpanElement, StatusChipProps>(function StatusChip(
  { children, className, tone = 'neutral', ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      {...props}
      className={cn(
        'inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium leading-none',
        TONE_SURFACE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
})

function StatusRows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-b border-border">{children}</ul>
}

function StatusRow({
  icon,
  label,
  value,
  detail,
  after,
  tone = 'neutral',
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  detail?: ReactNode
  after?: ReactNode
  tone?: Tone
}) {
  return (
    <li className={ROW_CLASS}>
      <span className={cn(ROW_ICON_CLASS, TONE_TEXT_CLASS[tone])}>{icon}</span>
      <span className={ROW_LABEL_CLASS}>{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={ROW_VALUE_CLASS}>{value}</div>
          {detail && <span className={ROW_DETAIL_CLASS}>{detail}</span>}
        </div>
        {after && <div className="flex shrink-0 items-center gap-1.5">{after}</div>}
      </div>
    </li>
  )
}

function MonoValue({
  children,
  title,
  tone,
  fill = false,
}: {
  children: ReactNode
  title?: string
  tone?: Tone
  fill?: boolean
}) {
  return (
    <span className={cn(MONO_VALUE_CLASS, fill && INLINE_TRUNCATE_CLASS, tone && TONE_TEXT_CLASS[tone])} title={title}>
      {children}
    </span>
  )
}

function SyncValue({
  ahead,
  behind,
  noUpstream,
  upToDateLabel,
  aheadLabel,
  behindLabel,
}: {
  ahead: number
  behind: number
  noUpstream: boolean
  upToDateLabel: string
  aheadLabel: string
  behindLabel: string
}) {
  if (noUpstream) return <StatusChip tone="warning">{upToDateLabel}</StatusChip>
  if (ahead === 0 && behind === 0) {
    return (
      <StatusChip tone="success">
        <Check size={11} />
        {upToDateLabel}
      </StatusChip>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {ahead > 0 && (
        <StatusChip tone="success">
          <ArrowUp size={12} />
          {aheadLabel}
        </StatusChip>
      )}
      {behind > 0 && (
        <StatusChip tone="warning">
          <ArrowDown size={12} />
          {behindLabel}
        </StatusChip>
      )}
    </span>
  )
}

function CopyableValue({
  value,
  copyValue = value,
  copyLabel,
  copiedLabel,
}: {
  value: string
  copyValue?: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const t = useT()
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setCopied(false)
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = null
    }
  }, [copyValue])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
    }
  }, [])

  function copy() {
    void navigator.clipboard
      .writeText(copyValue)
      .then(() => {
        setCopied(true)
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
      })
      .catch((err: unknown) => {
        toast.error(t('action.result-error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <MonoValue title={value} fill>
        {value}
      </MonoValue>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground hover:text-foreground"
        aria-label={copyLabel}
        title={copied ? copiedLabel : copyLabel}
        onClick={copy}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </div>
  )
}

export function BranchStatus({ detail }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const { branch, statusCount, pullRequestsLoading } = detail
  if (!branch) return <EmptyState title={t('branches.empty')} />

  const protectedBranch = PROTECTED_BRANCHES.has(branch.name)
  const worktreePath = branch.worktreePath ? tildify(branch.worktreePath) : ''
  const worktreeChangeCount = statusCount > 0 ? statusCount : (branch.worktreeChangeCount ?? 0)
  const hasRole = branch.isCurrent || branch.isDefault || protectedBranch
  const hasWorktreeChanges = !!branch.worktreePath && (branch.worktreeDirty || worktreeChangeCount > 0)
  const mergeKnown = branch.isDefault || branch.mergedToDefault !== undefined
  const showMerged = !branch.isDefault
  const mergeLabel = !mergeKnown
    ? t('branch-status.merge-unknown')
    : branch.mergedToDefault || branch.isDefault
      ? t('branch-status.merged')
      : t('branch-status.not-merged')
  const mergeTone: Tone = !mergeKnown ? 'neutral' : branch.mergedToDefault ? 'success' : 'warning'
  const prTone: Tone =
    branch.pullRequest?.state === 'merged' ? 'success' : branch.pullRequest?.state === 'open' ? 'brand' : 'warning'
  const prLabel = branch.pullRequest
    ? t('branch-status.pr.summary', {
        n: branch.pullRequest.number,
        state:
          branch.pullRequest.isDraft && branch.pullRequest.state === 'open'
            ? t('branch-status.pr.draft')
            : t(`branch-status.pr.${branch.pullRequest.state}`),
      })
    : ''
  const prTitle = branch.pullRequest?.title
  const remoteTone: Tone = branch.trackingGone || !branch.tracking ? 'warning' : 'brand'
  const syncTone: Tone = !branch.tracking ? 'warning' : branch.behind > 0 ? 'warning' : 'success'
  const worktreeTone: Tone =
    branch.worktreeLocked || hasWorktreeChanges ? 'warning' : branch.worktreePath ? 'brand' : 'neutral'
  const worktreeValue = branch.worktreePath ? (
    <CopyableValue
      value={worktreePath}
      copyValue={branch.worktreePath}
      copyLabel={t('branch-status.copy-worktree-path')}
      copiedLabel={t('branch-status.copied')}
    />
  ) : (
    <StatusChip>{t('branch-status.worktree.none')}</StatusChip>
  )
  const worktreeAfter =
    branch.worktreeLocked || hasWorktreeChanges ? (
      <>
        {branch.worktreeLocked && <StatusChip tone="warning">{t('branch-status.worktree.locked')}</StatusChip>}
        {hasWorktreeChanges && (
          <StatusChip tone="warning">{t('branch-status.worktree-dirty', { n: worktreeChangeCount })}</StatusChip>
        )}
      </>
    ) : undefined
  const remoteValue = branch.tracking ? (
    <MonoValue tone={branch.trackingGone ? 'warning' : undefined}>{branch.tracking}</MonoValue>
  ) : (
    <StatusChip tone="warning">{t('branches.no-upstream')}</StatusChip>
  )
  const remoteAfter = branch.trackingGone ? <StatusChip tone="warning">{t('branches.gone')}</StatusChip> : undefined

  const RoleChips = () =>
    hasRole ? (
      <>
        {branch.isCurrent && <StatusChip tone="success">{t('branch-status.current')}</StatusChip>}
        {branch.isDefault && <StatusChip>{t('branches.default')}</StatusChip>}
        {protectedBranch && <StatusChip>{t('branch-status.protected')}</StatusChip>}
      </>
    ) : null
  return (
    <ScrollPane>
      <StatusRows>
        <StatusRow
          icon={<GitBranch size={15} />}
          label={t('branch-status.signal.branch')}
          value={
            <CopyableValue
              value={branch.name}
              copyLabel={t('branch-status.copy-branch-name')}
              copiedLabel={t('branch-status.copied')}
            />
          }
          after={hasRole ? <RoleChips /> : undefined}
          tone={branch.isCurrent ? 'success' : branch.isDefault ? 'brand' : 'neutral'}
        />
        <StatusRow
          icon={<FolderTree size={14} />}
          label={t('branch-status.signal.worktree')}
          value={worktreeValue}
          after={worktreeAfter}
          tone={worktreeTone}
        />
        <StatusRow
          icon={<RadioTower size={14} />}
          label={t('branch-status.signal.remote')}
          value={remoteValue}
          after={remoteAfter}
          tone={remoteTone}
        />
        <StatusRow
          icon={<RefreshCw size={14} />}
          label={t('branch-status.signal.sync')}
          value={
            <SyncValue
              ahead={branch.ahead}
              behind={branch.behind}
              noUpstream={!branch.tracking}
              upToDateLabel={!branch.tracking ? t('branches.no-upstream') : t('branch-status.sync.up-to-date')}
              aheadLabel={t('branch-status.sync.ahead', { n: branch.ahead })}
              behindLabel={t('branch-status.sync.behind', { n: branch.behind })}
            />
          }
          tone={syncTone}
        />
        {showMerged && (
          <StatusRow
            icon={<GitMerge size={14} />}
            label={t('branch-status.signal.merge')}
            value={
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <StatusChip tone={mergeTone}>
                  {mergeKnown && branch.mergedToDefault && <Check size={11} />}
                  {mergeLabel}
                </StatusChip>
                {branch.pullRequest && (
                  <Tip
                    label={<span className="block max-w-80 whitespace-normal break-words">{prTitle}</span>}
                    side="right"
                  >
                    <StatusChip tone={prTone}>{prLabel}</StatusChip>
                  </Tip>
                )}
                {pullRequestsLoading && !branch.pullRequest && (
                  <StatusChip>
                    <RefreshCw size={11} className="animate-spin" />
                    {t('branch-status.pr.loading')}
                  </StatusChip>
                )}
              </span>
            }
            tone={mergeTone}
          />
        )}
        <StatusRow
          icon={<GitCommitHorizontal size={14} />}
          label={t('branch-status.signal.commit')}
          value={branch.lastCommitMessage || '—'}
          detail={`${branch.lastCommitAuthor} · ${formatRelativeTime(branch.lastCommitDate, lang)}`}
        />
      </StatusRows>
    </ScrollPane>
  )
}
