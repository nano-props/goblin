// Top app bar. Holds the ambient settings entry.
// The .topbar CSS rule turns this into the OS drag region; child buttons
// opt out via -webkit-app-region: no-drag (set globally on `button` and
// any element with `data-interactive`).

import { Settings } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Logo } from '#/renderer/components/Logo.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'

interface Props {
  onOpenSettings: () => void
}

export function Topbar({ onOpenSettings }: Props) {
  const t = useT()

  return (
    <div className="topbar relative flex h-10 items-center gap-2 border-b border-separator bg-background text-sm">
      {/* Brand wordmark, centred over the title bar like a native macOS
       * window chrome (cf. Apple's HIG title-bar layout). Absolute so
       * its position is independent of how many action buttons sit on
       * the right; pointer-events-none keeps the OS drag region
       * unblocked beneath it. Open now lives in the repo tab strip, so
       * the remaining title-bar actions fit at the window's minimum
       * width without hiding the wordmark. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Logo />
      </div>

      <div className="flex-1" />

      {/* Topbar actions are ghost-icon-only — same idiom as macOS title
       * bars and the deck-app reference: hover surfaces the button,
       * tooltips name the action. */}
      <Tip label={t('topbar.settings')}>
        <Button variant="ghost" size="icon" onClick={() => onOpenSettings()} aria-label={t('topbar.settings')}>
          <Settings />
        </Button>
      </Tip>
    </div>
  )
}
