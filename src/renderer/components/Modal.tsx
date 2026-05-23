// Lightweight modal — shadcn/ui Dialog under the hood. Radix gives us:
//   - proper focus trap (Tab/Shift+Tab cycle stays inside the panel)
//   - focus restoration to the triggering element on close
//   - aria-modal + aria-labelledby wiring
//   - Esc + click-outside dismissal
// Without those, keyboard users could Tab into the dimmed background
// and end up clicking buttons they couldn't see.

import { type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/renderer/components/ui/dialog.tsx'
import { cn } from '#/renderer/lib/cn.ts'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Tailwind width class. Default `sm:max-w-md`. */
  widthClass?: string
}

export function Modal({ open, title, onClose, children, widthClass = 'sm:max-w-md' }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* p-0 + gap-0 to take full control: shadcn's default p-4 gap-3
       * works for marketing-style dialogs but we want a section-style
       * layout (bordered header on top, scrollable body below) for
       * Settings / Help, where the title is a list-section header
       * rather than a hero. */}
      <DialogContent className={cn('p-0 gap-0', widthClass)}>
        <DialogHeader className="px-4 py-3 border-b border-separator text-left">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="p-4 max-h-[70vh] overflow-y-auto scroll-thin">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
