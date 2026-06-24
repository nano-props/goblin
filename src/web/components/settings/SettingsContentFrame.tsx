import type { ReactNode } from 'react'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
interface SettingsContentFrameProps {
  topInset?: number
  children: ReactNode
}

export function SettingsContentFrame({ topInset = 0, children }: SettingsContentFrameProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background" style={{ paddingTop: topInset }}>
      <ScrollArea className="min-h-0 flex-1 bg-background">
        <div className="space-y-5 px-5 py-4">{children}</div>
      </ScrollArea>
    </section>
  )
}
