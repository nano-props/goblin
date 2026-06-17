export const focusRing =
  'focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring'

export const openRing =
  'data-[state=open]:-outline-offset-2 data-[state=open]:outline-2 data-[state=open]:outline-solid data-[state=open]:outline-ring'

export const dataActiveRing =
  'data-[active=true]:-outline-offset-2 data-[active=true]:outline-2 data-[active=true]:outline-solid data-[active=true]:outline-ring'

export const compositeFocusRing =
  '[&:has(:focus-visible)]:-outline-offset-2 [&:has(:focus-visible)]:outline-2 [&:has(:focus-visible)]:outline-solid [&:has(:focus-visible)]:outline-ring'

// Inset box-shadow focus rings — drawn *inside* the border box, so they
// belong to the element's own rendering and survive any ancestor
// overflow:hidden / clip-path / scroll-container. Concentric outer rings
// are fundamentally clip-fragile (the AnimateHeight height transition
// was clipping Input's left/right focus halo because the input sits
// flush against the clipping edge).
//
// Each component still needs to suppress the browser default outline in
// the same className (focus:outline-none or focus:outline-hidden) — the
// ring replaces the outline, not augments it.

// Form-field ring (Input, dialog close, etc.). Used with `:focus` so
// autoFocus / mouse-click both surface the ring; pair with focus:outline-none.
export const focusRingInset = 'focus:ring-2 focus:ring-inset focus:ring-ring'

// Compact-control ring (Badge, Switch, Checkbox, Select trigger). Used
// with `:focus-visible` so only keyboard nav shows it; 3px at half
// opacity reads as a halo without dominating the chip silhouette.
export const focusRingVisibleInset = 'focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50'
