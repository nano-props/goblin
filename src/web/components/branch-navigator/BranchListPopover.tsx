// Hover-triggered branch popover used by the Topbar's focus-mode
// toggle. Hover card around the shared BranchView; the list, action
// menu, and data wiring live in one place, the popover only adds
// the trigger and the close-on-select behaviour. The parent only
// mounts this while workspaceFocused is true, so a focus-off flip
// just unmounts us — we don't subscribe to the store here.
//
// The inner container is a ScrollArea in compact mode so the
// scrollbar matches the rest of the app (pane, repo picker,
// workspace-pane view strip) instead of falling back to the
// platform default. Compact omits the 11×11 transparent hit-target
// used in the persistent pane — the popover is auxiliary, so its
// scrollbar should feel lighter and its hit-area doesn't need to
// be that generous.

import { useState, type ReactNode } from 'react'
import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '#/web/components/ui/hover-card.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

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
        <ScrollArea className="max-h-96" scrollbarMode="compact">
          <BranchView
            repoId={repoId}
            onAfterSelect={() => setOpen(false)}
            onAfterOpenStatus={() => setOpen(false)}
          />
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  )
}