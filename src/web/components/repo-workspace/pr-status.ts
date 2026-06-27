import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { StatusTone } from '#/web/components/ui/status-tones.ts'
export type PrHealthTone = Exclude<StatusTone, 'brand'>
export type PrHealthSignal = { tone: PrHealthTone; label: string }

export function visiblePrHealthSignals(pr: PullRequestInfo | undefined, signals: PrHealthSignal[]): PrHealthSignal[] {
  if (!pr || pr.state !== 'open') return []
  return signals
}

export function prChipTone(pr: PullRequestInfo | undefined, signals: PrHealthSignal[]): StatusTone {
  if (!pr) return 'neutral'
  if (pr.state === 'merged') return 'success'
  if (pr.state === 'closed' || signals.some((signal) => signal.tone === 'danger')) return 'danger'
  if (pr.isDraft && pr.state === 'open') return 'neutral'
  if (signals.some((signal) => signal.tone === 'warning' || signal.tone === 'attention')) return 'attention'
  if (signals.some((signal) => signal.tone === 'neutral')) return 'neutral'
  if (signals.length > 0 && signals.every((signal) => signal.tone === 'success')) return 'success'
  return 'brand'
}
