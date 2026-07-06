import type { ReactNode } from 'react'

export interface WorkspacePanePanelFrameProps {
  id: string
  labelledById?: string
  label?: string
  busy?: boolean
  children: ReactNode
}

export function WorkspacePanePanelFrame({
  id,
  labelledById,
  label,
  busy = false,
  children,
}: WorkspacePanePanelFrameProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={labelledById}
      aria-label={labelledById ? undefined : label}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}
