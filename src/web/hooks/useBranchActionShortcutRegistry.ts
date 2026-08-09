import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { type BranchActionSurface, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import { setBranchActionShortcutHandler } from '#/web/keyboard/branch-action-shortcuts.ts'
import type { BranchActionShortcutAction } from '#/shared/shortcut-definitions.ts'

type BranchActionShortcutItems = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>

export function useBranchActionShortcutRegistry(
  actions: MaybeRefOrGetter<BranchActionShortcutItems>,
  enabled: MaybeRefOrGetter<boolean> = true,
  additionalHandlers?: MaybeRefOrGetter<Partial<Record<BranchActionShortcutAction, () => void>> | undefined>,
): void {
  // This watch owns the lifetime of the global shortcut registration. The
  // callback reads the latest action projections only when a shortcut fires.
  watch(
    () => toValue(enabled),
    (active, _previous, onCleanup) => {
      if (!active) return
      onCleanup(
        setBranchActionShortcutHandler((action) => {
          const item = visibleBranchActionItems(toValue(actions)).find((candidate) => candidate.id === action)
          if (item && !item.disabled) {
            void item.onSelect()
            return
          }
          toValue(additionalHandlers)?.[action]?.()
        }),
      )
    },
    { immediate: true },
  )
}
