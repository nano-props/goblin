import { useEffect, useRef } from 'react'
import { type BranchActionSurface, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { setBranchActionShortcutHandler } from '#/web/keyboard/branch-action-shortcuts.ts'
import type { BranchActionShortcutAction } from '#/shared/shortcut-definitions.ts'

type BranchActionShortcutItems = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>

export function useBranchActionShortcutRegistry(
  actions: BranchActionShortcutItems,
  enabled = true,
  additionalHandlers?: Partial<Record<BranchActionShortcutAction, () => void>>,
): void {
  const visibleItems = enabled ? visibleBranchActionItems(actions) : []
  const visibleItemsRef = useRef(visibleItems)
  visibleItemsRef.current = visibleItems

  const additionalHandlersRef = useRef(additionalHandlers)
  additionalHandlersRef.current = additionalHandlers

  useEffect(() => {
    if (!enabled) return
    return setBranchActionShortcutHandler((action) => {
      const item = visibleItemsRef.current.find((candidate) => candidate.id === action)
      if (item && !item.disabled) {
        void item.onSelect()
        return
      }
      const additional = additionalHandlersRef.current?.[action]
      if (additional) {
        additional()
      }
    })
  }, [enabled])
}
