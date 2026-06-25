import type { ExternalAppSvgProps } from '#/web/components/ExternalAppIcon/types.ts'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'

export function FinderIcon({ className, ...props }: ExternalAppSvgProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={svgClass(className)} {...props}>
      <path
        d="M12.5 1.5c-.833 2-2.5 7.2-2.5 12h3c0 2.537.2 6.6 1 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 7.5v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 7.5v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 15.5c.667 1 2.9 3 6.5 3s5.667-2 6.5-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 18.5v-13a4 4 0 0 1 4-4h13a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4h-13a4 4 0 0 1-4-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
