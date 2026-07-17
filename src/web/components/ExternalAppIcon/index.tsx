import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import { SquareTerminal } from 'lucide-react'
import { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
import { GhosttyIcon } from '#/web/components/ExternalAppIcon/GhosttyIcon.tsx'
import type { AppIconProps } from '#/web/components/ExternalAppIcon/types.ts'
import { VSCodeIcon } from '#/web/components/ExternalAppIcon/VSCodeIcon.tsx'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'

export function TerminalAppIcon({ pref, className }: AppIconProps & { pref: TerminalApp }) {
  if (pref === 'terminal') return <AppleTerminalIcon className={className} />
  if (pref === 'windowsTerminal') return <SquareTerminal className={svgClass(className)} />
  return <GhosttyIcon className={className} />
}

export function EditorAppIcon({ pref, className }: AppIconProps & { pref: EditorApp }) {
  switch (pref) {
    case 'vscode':
      return <VSCodeIcon className={className} />
    default: {
      const exhaustive: never = pref
      return exhaustive
    }
  }
}

export { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
export { FinderIcon } from '#/web/components/ExternalAppIcon/FinderIcon.tsx'
export { GhosttyIcon } from '#/web/components/ExternalAppIcon/GhosttyIcon.tsx'
export { VSCodeIcon } from '#/web/components/ExternalAppIcon/VSCodeIcon.tsx'
