import { AlertCircle } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/renderer/components/ui/popover.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { MissingRepo } from '#/renderer/stores/repos/types.ts'

interface MissingReposPopoverProps {
  missing: MissingRepo[]
  title: string
  dismissLabel: string
  onDismiss: () => void
}

export function MissingReposPopover({ missing, title, dismissLabel, onDismiss }: MissingReposPopoverProps) {
  const t = useT()
  if (missing.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 text-warning hover:text-warning"
          aria-label={title}
        >
          <AlertCircle size={12} />
          {missing.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5 text-xs">
            <AlertCircle size={13} className="text-warning" />
            {title}
          </PopoverTitle>
        </PopoverHeader>
        <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto scroll-thin">
          {missing.map((entry) => {
            const displayPath = tildify(entry.path)
            const reason = formatReason(entry.reason, t)
            return (
              <li key={entry.path} className="rounded-sm bg-muted px-1.5 py-1" title={`${displayPath}\n${reason}`}>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{displayPath}</div>
                <div className="mt-0.5 truncate text-[11px] text-warning">{reason}</div>
              </li>
            )
          })}
        </ul>
        <Button type="button" variant="ghost" size="sm" className="mt-2 h-6 px-1.5" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function formatReason(reason: string, t: (key: string) => string): string {
  return reason.startsWith('error.') ? t(reason) : reason
}
