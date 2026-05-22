import { GitPullRequest } from 'lucide-react'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { CopyButton } from '#/renderer/components/CopyButton.tsx'
import { Tip } from '#/renderer/components/Tip.tsx'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import {
  prChipTone,
  visiblePrHealthSignals,
  type PrHealthSignal,
} from '#/renderer/components/branch-detail/pr-status.ts'
import { StatusChip, StatusRow, type Tone } from '#/renderer/components/branch-detail/status-ui.tsx'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { Lang } from '#/renderer/types-bridge.ts'

type TFn = (key: string, params?: Record<string, string | number>) => string

function prChecksSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.checks) return null
  const params = { n: pr.checks.failing || pr.checks.pending || pr.checks.passing, total: pr.checks.total }
  if (pr.checks.failing > 0) return { tone: 'warning', label: t('branch-status.pr.checks-failing', params) }
  if (pr.checks.pending > 0) return { tone: 'neutral', label: t('branch-status.pr.checks-pending', params) }
  return { tone: 'success', label: t('branch-status.pr.checks-passing', params) }
}

function prReviewSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.reviewDecision) return null
  if (pr.reviewDecision === 'APPROVED') {
    return { tone: 'success', label: t('branch-status.pr.review-approved') }
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return { tone: 'warning', label: t('branch-status.pr.review-changes-requested') }
  }
  return { tone: 'neutral', label: t('branch-status.pr.review-required') }
}

function prMergeSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.mergeable) return null
  if (pr.mergeable === 'MERGEABLE') return { tone: 'success', label: t('branch-status.pr.mergeable') }
  if (pr.mergeable === 'CONFLICTING') return { tone: 'warning', label: t('branch-status.pr.merge-conflicting') }
  return { tone: 'neutral', label: t('branch-status.pr.merge-unknown') }
}

function prHealthSignals(pr: PullRequestInfo | undefined, t: TFn): PrHealthSignal[] {
  if (!pr) return []
  return visiblePrHealthSignals(
    pr,
    [prChecksSignal(pr, t), prReviewSignal(pr, t), prMergeSignal(pr, t)].filter(
      (signal): signal is PrHealthSignal => signal !== null,
    ),
  )
}

function prSummary(pr: PullRequestInfo, t: TFn): string {
  return t('branch-status.pr.summary', {
    n: pr.number,
    state: pr.isDraft && pr.state === 'open' ? t('branch-status.pr.draft') : t(`branch-status.pr.${pr.state}`),
  })
}

function prSignalLabel(signal: PrHealthSignal): string {
  if (signal.tone === 'warning') return `× ${signal.label}`
  if (signal.tone === 'neutral') return `○ ${signal.label}`
  return `✓ ${signal.label}`
}

function prChipLabel(pr: PullRequestInfo | undefined, signals: PrHealthSignal[], t: TFn): string {
  if (!pr) return ''
  return [prSummary(pr, t), ...signals.map(prSignalLabel)].join(' · ')
}

function prTooltip(pr: PullRequestInfo, lang: Lang, t: TFn): { title: string; meta: string[] } {
  const created = pr.createdAt ? formatRelativeTime(pr.createdAt, lang) : null
  const byline =
    pr.author && created
      ? t('branch-status.pr.created-by', { author: pr.author, time: created })
      : [pr.author, created].filter(Boolean).join(' · ')
  return {
    title: pr.title,
    meta: [byline || null, `${pr.baseRefName ?? '—'} ← ${pr.headRefName ?? '—'}`].filter((line): line is string =>
      Boolean(line),
    ),
  }
}

function PullRequestValue({
  tone,
  label,
  tooltip,
  url,
  copyLabel,
  copiedLabel,
}: {
  tone: Tone
  label: string
  tooltip: { title: string; meta: string[] }
  url: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tip
        label={
          <div className="max-w-[min(24rem,calc(100vw-2rem),var(--radix-tooltip-content-available-width))] space-y-1">
            <div className="overflow-hidden break-words font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {tooltip.title}
            </div>
            <div className="space-y-0.5 whitespace-pre-line break-words text-muted-foreground">
              {tooltip.meta.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        }
        side="right"
        align="end"
        collisionPadding={16}
      >
        <StatusChip tone={tone} className="min-w-0 shrink">
          <span className="truncate">{label}</span>
        </StatusChip>
      </Tip>
      <CopyButton value={url} copyLabel={copyLabel} copiedLabel={copiedLabel} className="shrink-0" />
    </div>
  )
}

export function PullRequestStatusRow({ pullRequest }: { pullRequest: PullRequestInfo | undefined }) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  if (!pullRequest) return null

  const signals = prHealthSignals(pullRequest, t)
  const tone = prChipTone(pullRequest, signals)
  const label = prChipLabel(pullRequest, signals, t)
  const tooltip = prTooltip(pullRequest, lang, t)

  return (
    <StatusRow
      icon={<GitPullRequest size={14} />}
      label={t('branch-status.signal.pr')}
      value={
        <PullRequestValue
          tone={tone}
          label={label}
          tooltip={tooltip}
          url={pullRequest.url}
          copyLabel={t('branch-status.pr.copy-link')}
          copiedLabel={t('branch-status.copied')}
        />
      }
      tone={tone}
    />
  )
}
