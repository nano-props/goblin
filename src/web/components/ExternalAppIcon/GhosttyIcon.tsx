import type { ExternalAppSvgProps } from '#/web/components/ExternalAppIcon/types.ts'
import { svgClass } from '#/web/components/ExternalAppIcon/svg-class.ts'
export function GhosttyIcon({ className, ...props }: ExternalAppSvgProps) {
  return (
    <svg viewBox="0 0 27 32" aria-hidden="true" className={svgClass(className)} {...props}>
      <path
        d="M23.9119 13.3627V25.6165C23.9119 27.4919 22.4654 29.079 20.5923 29.1822C19.6827 29.2314 18.8435 28.936 18.1941 28.4132C17.4158 27.7873 16.321 27.8154 15.5356 28.4343C14.9378 28.9055 14.183 29.1869 13.3601 29.1869C12.5372 29.1869 11.7847 28.9055 11.1869 28.4343C10.3922 27.8084 9.29738 27.8084 8.50266 28.4343C7.90954 28.9009 7.16405 29.1822 6.35291 29.1869C4.40478 29.2009 2.81299 27.5599 2.81299 25.6118V13.3627C2.81299 7.53704 7.5368 2.81323 13.3624 2.81323C19.1881 2.81323 23.9119 7.53704 23.9119 13.3627Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="m6.6 11.1 3.9 2.27-3.9 2.26M15.2 13.36h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
