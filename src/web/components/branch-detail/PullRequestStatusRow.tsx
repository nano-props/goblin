import { Check, Circle, GitPullRequest, X } from 'lucide-react'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import {
  TOOLTIP_META_TEXT_CLASS,
  TOOLTIP_STACK_MD_CLASS,
  TOOLTIP_STACK_SM_CLASS,
} from '#/web/components/ui/tooltip.tsx'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { cn } from '#/web/lib/cn.ts'
import { prChipTone, visiblePrHealthSignals, type PrHealthSignal } from '#/web/components/branch-detail/pr-status.ts'
import {
  STATUS_INLINE_GROUP_CLASS,
  StatusChip,
  StatusRow,
  type Tone,
} from '#/web/components/branch-detail/status-ui.tsx'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { Lang } from '#/shared/rpc.ts'
type TFn = (key: string, params?: Record<string, string | number>) => string
type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

function prChecksSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.checks) return null
  const params = { n: pr.checks.failing || pr.checks.pending || pr.checks.passing, total: pr.checks.total }
  if (pr.checks.failing > 0) return { tone: 'danger', label: t('branch-status.pr.checks-failing', params) }
  if (pr.checks.pending > 0) return { tone: 'attention', label: t('branch-status.pr.checks-pending', params) }
  return { tone: 'success', label: t('branch-status.pr.checks-passing', params) }
}

function prReviewSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.reviewDecision) return null
  if (pr.reviewDecision === 'APPROVED') {
    return { tone: 'success', label: t('branch-status.pr.review-approved') }
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return { tone: 'danger', label: t('branch-status.pr.review-changes-requested') }
  }
  return { tone: 'attention', label: t('branch-status.pr.review-required') }
}

function prMergeSignal(pr: PullRequestInfo, t: TFn): PrHealthSignal | null {
  if (!pr.mergeable) return null
  if (pr.mergeable === 'MERGEABLE') return { tone: 'success', label: t('branch-status.pr.mergeable') }
  if (pr.mergeable === 'CONFLICTING') return { tone: 'danger', label: t('branch-status.pr.merge-conflicting') }
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

function prSummaryTone(pr: PullRequestInfo): Tone {
  if (pr.state === 'merged') return 'success'
  if (pr.state === 'closed') return 'danger'
  if (pr.isDraft && pr.state === 'open') return 'neutral'
  return 'brand'
}

function PrSignalIcon({ tone }: { tone: PrHealthSignal['tone'] }) {
  if (tone === 'danger') return <X size={11} />
  if (tone === 'success') return <Check size={11} />
  return <Circle size={9} />
}

function PrSignalChip({ signal }: { signal: PrHealthSignal }) {
  return (
    <StatusChip tone={signal.tone} className="min-w-0 shrink">
      <PrSignalIcon tone={signal.tone} />
      <span className="truncate">{signal.label}</span>
    </StatusChip>
  )
}

function prTooltip(pr: PullRequestInfo, lang: Lang, t: TFn): { title: string; meta: string[] } {
  const created = formatRelativeTimeOrNull(pr.createdAt, lang)
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
  summary,
  summaryTone,
  signals,
  tooltip,
  url,
  copyLabel,
  copiedLabel,
  tooltipSide,
}: {
  summary: string
  summaryTone: Tone
  signals: PrHealthSignal[]
  tooltip: { title: string; meta: string[] }
  url: string
  copyLabel: string
  copiedLabel: string
  tooltipSide: TooltipSide
}) {
  const tooltipAlign = tooltipSide === 'bottom' ? 'center' : 'end'
  // Radix Tooltip exposes the available-width var; the fallback keeps the
  // CSS valid if the implementation ever stops providing it.
  const tooltipContentClass = `max-w-[min(24rem,calc(100vw-2rem),var(--radix-tooltip-content-available-width,calc(100vw-2rem)))] ${TOOLTIP_STACK_MD_CLASS}`
  return (
    <div className={STATUS_INLINE_GROUP_CLASS}>
      <Tip
        label={
          <div className={tooltipContentClass}>
            <div className="overflow-hidden break-words font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {tooltip.title}
            </div>
            <div className={cn(TOOLTIP_STACK_SM_CLASS, 'whitespace-pre-line break-words', TOOLTIP_META_TEXT_CLASS)}>
              {tooltip.meta.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        }
        side={tooltipSide}
        align={tooltipAlign}
        collisionPadding={16}
      >
        <div className="flex min-w-0 max-w-full items-center gap-1.5">
          <StatusChip tone={summaryTone} className="min-w-0 shrink">
            <span className="truncate">{summary}</span>
          </StatusChip>
          {signals.map((signal) => (
            <PrSignalChip key={`${signal.tone}:${signal.label}`} signal={signal} />
          ))}
        </div>
      </Tip>
      <CopyButton value={url} copyLabel={copyLabel} copiedLabel={copiedLabel} className="shrink-0" />
    </div>
  )
}

export function PullRequestStatusRow({
  pullRequest,
  tooltipSide = 'right',
}: {
  pullRequest: PullRequestInfo | undefined
  tooltipSide?: TooltipSide
}) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  if (!pullRequest) return null

  const signals = prHealthSignals(pullRequest, t)
  const tone = prChipTone(pullRequest, signals)
  const summary = prSummary(pullRequest, t)
  const summaryTone = prSummaryTone(pullRequest)
  const tooltip = prTooltip(pullRequest, lang, t)

  return (
    <StatusRow
      icon={<GitPullRequest size={14} />}
      label={t('branch-status.signal.pr')}
      value={
        <PullRequestValue
          summary={summary}
          summaryTone={summaryTone}
          signals={signals}
          tooltip={tooltip}
          url={pullRequest.url}
          copyLabel={t('branch-status.pr.copy-link')}
          copiedLabel={t('branch-status.copied')}
          tooltipSide={tooltipSide}
        />
      }
      valueLayout="fill"
      tone={tone}
    />
  )
}
