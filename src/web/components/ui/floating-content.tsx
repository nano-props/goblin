import type { ClassValue } from 'clsx'
import { cn } from '#/web/lib/cn.ts'

const FLOATING_CONTENT_BASE_CLASS =
  'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

export function floatingContentClass(transformOriginVar: string, classValue?: ClassValue): string {
  return cn(FLOATING_CONTENT_BASE_CLASS, `origin-(${transformOriginVar})`, classValue)
}
