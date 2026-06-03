const SHORTCUT_BLOCKING_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="dropdown-menu-sub-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]',
].join(',')

export function isShortcutBlockingLayerOpen(): boolean {
  return document.querySelector(SHORTCUT_BLOCKING_LAYER_SELECTOR) !== null
}
