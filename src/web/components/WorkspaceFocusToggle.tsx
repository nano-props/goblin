import { PanelLeft } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'

type WorkspaceFocusToggleProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'aria-label' | 'aria-pressed' | 'children' | 'onClick' | 'size' | 'title' | 'type' | 'variant'
>

export const WorkspaceFocusToggle = forwardRef<HTMLButtonElement, WorkspaceFocusToggleProps>(
  function WorkspaceFocusToggle({ className, ...props }, ref) {
    const t = useT()
    const workspaceFocused = useReposStore((s) => s.workspaceFocused)
    const toggleWorkspaceFocused = useReposStore((s) => s.toggleWorkspaceFocused)
    const label = t('workspace.focus-toggle-tooltip.enable')
    return (
      <Button
        {...props}
        ref={ref}
        type="button"
        variant="ghost"
        size="icon-lg"
        onClick={toggleWorkspaceFocused}
        aria-pressed={workspaceFocused}
        aria-label={t('workspace.focus-toggle-label')}
        title={workspaceFocused ? undefined : label}
        className={className}
      >
        <PanelLeft />
      </Button>
    )
  },
)
