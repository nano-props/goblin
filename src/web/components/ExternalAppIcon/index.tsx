import type { ResolvedEditorApp, ResolvedTerminalApp } from '#/shared/rpc.ts'
import { Code2, SquareTerminal, Terminal } from 'lucide-react'
import { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
import { CursorIcon } from '#/web/components/ExternalAppIcon/CursorIcon.tsx'
import { GhosttyIcon } from '#/web/components/ExternalAppIcon/GhosttyIcon.tsx'
import type { AppIconProps } from '#/web/components/ExternalAppIcon/types.ts'
import { VSCodeIcon } from '#/web/components/ExternalAppIcon/VSCodeIcon.tsx'
import { WindsurfIcon } from '#/web/components/ExternalAppIcon/WindsurfIcon.tsx'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'
type TerminalIconPref = ResolvedTerminalApp | 'auto'
type EditorIconPref = ResolvedEditorApp | 'auto'

export function TerminalAppIcon({ pref, className }: AppIconProps & { pref: TerminalIconPref }) {
  if (pref === 'auto') return <Terminal className={svgClass(className)} />
  if (pref === 'terminal') return <AppleTerminalIcon className={className} />
  if (pref === 'windowsTerminal') return <SquareTerminal className={svgClass(className)} />
  return <GhosttyIcon className={className} />
}

export function EditorAppIcon({ pref, className }: AppIconProps & { pref: EditorIconPref }) {
  if (pref === 'auto') return <Code2 className={svgClass(className)} />
  if (pref === 'cursor') return <CursorIcon className={className} />
  if (pref === 'windsurf') return <WindsurfIcon className={className} />
  return <VSCodeIcon className={className} />
}

export { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
export { CursorIcon } from '#/web/components/ExternalAppIcon/CursorIcon.tsx'
export { GhosttyIcon } from '#/web/components/ExternalAppIcon/GhosttyIcon.tsx'
export { VSCodeIcon } from '#/web/components/ExternalAppIcon/VSCodeIcon.tsx'
export { WindsurfIcon } from '#/web/components/ExternalAppIcon/WindsurfIcon.tsx'
