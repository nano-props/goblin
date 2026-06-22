// Hover-triggered branch popover used by the Topbar's focus-mode
// toggle. Hover card around the shared BranchView; the list, action
// menu, and data wiring live in one place, the popover only adds
// the trigger and the close-on-select behaviour. The parent only
// mounts this while workspaceFocused is true, so a focus-off flip
// just unmounts us — we don't subscribe to the store here.

import { useState, type ReactNode } from 'react'
import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '#/web/components/ui/hover-card.tsx'

interface Props {
  repoId: string
  /** Trigger element (typically the focus-mode toggle Button). */
  children: ReactNode
}

export function BranchListPopover({ repoId, children }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-fit max-w-[min(40rem,calc(100vw-1rem))] p-0"
      >
        <div className="max-h-96 overflow-auto">
          <BranchView
            repoId={repoId}
            onAfterSelect={() => setOpen(false)}
            onAfterOpenStatus={() => setOpen(false)}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}