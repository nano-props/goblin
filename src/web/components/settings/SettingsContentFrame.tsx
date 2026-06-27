import type { ReactNode } from 'react'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'

interface SettingsContentFrameProps {
  topInset?: number
  title: string
  children: ReactNode
}

export function SettingsContentFrame({ topInset = 0, title, children }: SettingsContentFrameProps) {
  const chromeHeight = topInset > 0 ? topInset : TITLE_BAR_HEIGHT_PX

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="app-drag-region shrink-0 bg-background" aria-hidden style={{ height: chromeHeight }} />
      <ScrollArea className="min-h-0 w-full flex-1 bg-background">
        <div className="w-full space-y-5 px-5 pb-4 pt-4">
          <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
          {children}
        </div>
      </ScrollArea>
    </section>
  )
}
