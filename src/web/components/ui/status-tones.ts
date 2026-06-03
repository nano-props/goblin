export type StatusTone = 'neutral' | 'success' | 'attention' | 'warning' | 'danger' | 'brand'

export const STATUS_TONE_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  attention: 'text-attention',
  warning: 'text-warning',
  danger: 'text-danger',
  brand: 'text-brand-text',
}

export const STATUS_TONE_CHIP_CLASS: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-success-border bg-success-surface text-success',
  attention: 'border-attention-border bg-attention-surface text-attention',
  warning: 'border-warning-border bg-warning-surface text-warning',
  danger: 'border-danger-border bg-danger-surface text-danger',
  brand: 'border-brand-border bg-brand-surface text-brand-text',
}
