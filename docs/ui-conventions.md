# UI and Copy

Use this doc for UI language and presentation rules.

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and help text.
- Use lowercase for status chips such as `open`, `dirty`, and `no upstream`.
- Preserve official casing such as `GitHub`, `VS Code`, and `PR`.
- Preserve raw git and status data such as `M`, `A`, `??`, branch names, and paths.
- Prefer shadcn/ui primitives in `src/web/components/ui/`.
- Reuse shared field primitives for forms.
- Show home-relative paths with `~` via existing `tildify` helpers.
- Focus rings on shadcn primitives use `focusRingInset` / `focusRingVisibleInset`
  from `src/web/components/ui/focus.ts`. These draw the ring _inside_ the
  border box (box-shadow inset), so ancestor `overflow: hidden` /
  `clip-path` / scroll containers can't slice the halo. Concentric outer
  rings are clip-fragile — the `AnimateHeight` height transition was
  previously clipping Input's left/right focus halo mid-animation.
