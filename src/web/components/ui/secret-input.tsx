import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { cn } from '#/web/lib/cn.ts'
interface SecretInputProps extends Omit<React.ComponentProps<typeof Input>, 'type'> {
  showLabel: string
  hideLabel: string
}

const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  ({ className, disabled, value, showLabel, hideLabel, ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false)
    const hasValue = typeof value === 'string' ? value.length > 0 : value != null

    React.useEffect(() => {
      if (!hasValue) setRevealed(false)
    }, [hasValue])

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          className={cn('pr-9', className)}
          {...props}
        />
        {hasValue && (
          <div className="absolute inset-y-0 right-1.5 flex items-center">
            <Button
              type="button"
              data-interactive
              size="icon-xs"
              variant="ghost"
              aria-label={revealed ? hideLabel : showLabel}
              className="text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRevealed((value) => !value)}
              disabled={disabled}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        )}
      </div>
    )
  },
)

SecretInput.displayName = 'SecretInput'

export { SecretInput }
