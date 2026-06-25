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
  neutral: 'border-separator/80 bg-muted/35 text-muted-foreground',
  success: 'border-success-border/55 bg-success-surface/50 text-success',
  attention: 'border-attention-border/55 bg-attention-surface/50 text-attention',
  warning: 'border-warning-border/55 bg-warning-surface/50 text-warning',
  danger: 'border-danger-border/55 bg-danger-surface/50 text-danger',
  brand: 'border-brand-border/55 bg-brand-surface/50 text-brand-text',
}
