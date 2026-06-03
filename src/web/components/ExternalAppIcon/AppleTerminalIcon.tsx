import type { ExternalAppSvgProps } from '#/web/components/ExternalAppIcon/types.ts'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'
export function AppleTerminalIcon({ className, ...props }: ExternalAppSvgProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={svgClass(className)} {...props}>
      <rect x="8" y="12" width="48" height="40" rx="8" fill="none" stroke="currentColor" strokeWidth="5" />
      <path
        d="m20 27 8 6-8 6M34 40h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
