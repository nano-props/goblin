import { AlertCircle } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/renderer/components/ui/popover.tsx'

interface MissingReposPopoverProps {
  missing: string[]
  title: string
  dismissLabel: string
  onDismiss: () => void
}

export function MissingReposPopover({ missing, title, dismissLabel, onDismiss }: MissingReposPopoverProps) {
  if (missing.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-warning hover:text-warning">
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
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto scroll-thin">
          {missing.map((p) => (
            <li
              key={p}
              className="truncate rounded-sm bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground"
              title={p}
            >
              {p}
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" size="sm" className="mt-2 h-6 px-1.5" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
