import { useId, type ReactNode } from 'react'
import { Checkbox } from '#/web/components/ui/checkbox.tsx'
import { cn } from '#/web/lib/cn.ts'
interface ConfirmCheckboxProps {
  checked: boolean
  children: ReactNode
  describedBy?: string
  destructive?: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  title?: string
}

export function ConfirmCheckbox({
  checked,
  children,
  describedBy,
  destructive = false,
  disabled = false,
  onCheckedChange,
  title,
}: ConfirmCheckboxProps) {
  const id = useId()
  return (
    <div
      className={cn(
        'flex items-center gap-2 select-none',
        disabled ? 'cursor-not-allowed text-muted-foreground' : 'text-foreground',
      )}
      title={title}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        variant={destructive ? 'destructive' : 'default'}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <label htmlFor={id} className={cn(disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        {children}
      </label>
    </div>
  )
}
