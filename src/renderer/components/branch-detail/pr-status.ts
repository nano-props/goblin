import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { Tone } from '#/renderer/components/branch-detail/status-ui.tsx'

export type PrHealthSignal = { tone: Tone; label: string }

export function visiblePrHealthSignals(pr: PullRequestInfo | undefined, signals: PrHealthSignal[]): PrHealthSignal[] {
  if (!pr || pr.state !== 'open') return []
  return signals
}

export function prChipTone(pr: PullRequestInfo | undefined, signals: PrHealthSignal[]): Tone {
  if (!pr) return 'neutral'
  if (pr.state === 'merged') return 'success'
  if (pr.state === 'closed' || signals.some((signal) => signal.tone === 'warning')) return 'warning'
  if (pr.isDraft && pr.state === 'open') return 'neutral'
  if (signals.some((signal) => signal.tone === 'neutral')) return 'neutral'
  if (signals.length > 0 && signals.every((signal) => signal.tone === 'success')) return 'success'
  return 'brand'
}
