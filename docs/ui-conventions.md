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
- 1px inline dividers go through `<Separator>` from `src/web/components/ui/separator.tsx`.
  Don't hand-roll `bg-separator w-px` or `border-l border-separator` —
  these used to drift in height across files (h-4 vs h-5) and in
  implementation (background fill vs left/right border). `Separator`
  defaults to `orientation="horizontal"` / `size="sm"`. For an inline
  vertical seam between toolbar siblings, use `<Separator orientation="vertical" />`
  (renders `h-4 w-px bg-separator`) and let the caller's `relative`
  parent add `absolute left-0|right-0 top-1/2 -translate-y-1/2` via
  `className` when the seam must overlay without consuming layout width.
  The chunkier `size="md"` (`h-5`) is reserved for any future 40px+
  toolbar — no current caller. Larger surface dividers (the topbar's
  own `border-b`, the sidebar's `border-r`, list `divide-y`) stay on
  Tailwind border utilities; they belong to the surrounding container's
  box, not a separate child element. All separators read their color
  from `--color-separator` (= `--goblin-border-subtle`, one notch
  weaker than `--color-border`).
- The topbar's `flex-1` spacer between the per-repo actions cluster
  (repo picker + Refresh / Filter / CreateWorktree) and the app-level
  cluster (Focus Mode toggle + Settings) is the only intentional
  exception to the inline-divider rule: the two clusters are
  separated by layout distance alone, not by `<Separator>`. The icon
  styles already differ enough on their own (the per-repo actions sit
  in the repo picker's tab family; the app-level buttons sit in the
  global ghost-button family), and a 1px line would just split a
  visual gap that already reads as a group break. If a future layout
  pulls the two clusters closer together, re-evaluate before reaching
  for `<Separator>`.
