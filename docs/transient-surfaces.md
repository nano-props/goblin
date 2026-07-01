# Transient Surfaces

Use this spec for temporary UI surfaces that appear from hover, focus, pointer
proximity, or another lightweight affordance, and that may contain anchored
floating controls.

## Core Invariant

A transient parent surface must not auto-dismiss while a descendant anchored
floating surface is open.

This invariant protects the anchor relationship: if a menu, popover, or similar
floating surface is opened from a transient parent, the anchor UI must remain
mounted, visible, and interactive until that child surface closes or the parent is
explicitly dismissed by a higher-level lifecycle transition.

Pointer hit-testing alone is not enough. A child floating surface may render
through a portal and sit outside the parent's DOM subtree, so the parent needs to
know whether a descendant floating surface is open, not merely whether the
pointer is currently over a floating element.

## Terms

| Term                          | Meaning                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Transient surface             | A temporary parent surface whose visibility is controlled by hover, focus, pointer proximity, or another ambient interaction. |
| Anchor-bound floating surface | A menu, popover, picker, or similar surface whose position and semantics depend on an anchor inside the transient parent.     |
| Boundary                      | A React-tree scope that lets descendants report open floating surfaces even when their content portals elsewhere in the DOM.  |
| Pinned                        | The transient parent suppresses ambient auto-close because at least one descendant floating surface is open.                  |

## Interaction Contract

The expected lifecycle is:

1. A transient parent opens from its normal trigger or proximity rule.
2. A descendant opens an anchor-bound floating surface.
3. The parent becomes pinned while that descendant surface is open.
4. Ambient close rules, such as pointer-leave or pointer-outside movement, are
   suppressed while pinned.
5. The child floating surface continues to own Escape, outside-click, focus
   restoration, and selection behavior.
6. When the child surface closes or unmounts, the parent becomes unpinned.
7. After unpinning, the parent resumes its normal ambient close policy.

Explicit parent lifecycle transitions still win. For example, exiting Zen Mode or
unmounting a workspace may close or remove the parent even if a descendant
surface was previously open.

## Primitive Contract

### `FloatingSurfaceBoundary`

`FloatingSurfaceBoundary` is the UI-layer primitive that tracks open floating
surfaces launched by descendants in the React tree.

Responsibilities:

- provide a boundary around the contents of a transient parent;
- aggregate open descendant floating surfaces as a count, not as
  consumer-specific identities;
- report pinned state as `openDescendantCount > 0`;
- remain independent of repo, branch, workspace, Zen Mode, or server modules.

The boundary deliberately tracks participation, not ownership. It does not open,
close, position, or render child surfaces; it only reports whether descendants
currently require the parent to remain stable.

### Shared Floating Primitives

Shared floating wrappers should report to the nearest
`FloatingSurfaceBoundary` when they have an effective open state.

Current rule for `Popover`:

- controlled and uncontrolled popovers both participate;
- one open popover contributes exactly one open unit;
- closing or unmounting removes that contribution;
- if no boundary exists, behavior is unchanged;
- callers such as repo pickers and row action menus do not add bespoke
  reporting code.

`DropdownMenu` should follow the same contract if a transient parent contains a
dropdown-backed control.

### Transient Parents

A transient parent owns its own visibility and interactivity policy. It consumes
boundary pinned state and applies it only to ambient dismissal.

While pinned, a parent should suppress:

- pointer-leave auto-close;
- document-level pointer-outside auto-close;
- proximity-based auto-close.

While pinned, a parent should not:

- trap focus;
- override Escape or outside-click behavior owned by the child floating
  primitive;
- centralize the child's local open state.

## State Ownership

Keep state at the layer that owns the invariant.

| State                                            | Owner                                                 |
| ------------------------------------------------ | ----------------------------------------------------- |
| Anchor-bound menu open state                     | Owning control, row, picker, or list component        |
| Transient parent open/rendered/interactive state | The transient parent or its local controller hook     |
| Descendant floating surface pin state            | `FloatingSurfaceBoundary` inside the transient parent |
| Cross-surface dialogs or confirmations           | Centralized dialog/app overlay state                  |

This keeps local menus close to their anchors while giving transient parents a
generic way to remain stable.

## Zen Mode Sidebar Reveal

The Zen Mode sidebar reveal is the first concrete transient parent using this
contract.

Requirements:

- wrap reveal contents in `FloatingSurfaceBoundary`;
- keep the reveal visible and interactive while descendant popovers are open;
- suppress pointer-leave and document pointer-move auto-close while pinned;
- keep resize dragging independent of pin state;
- resume normal close-on-leave behavior after the descendant surface closes.

The reveal must remain generic. It should not know whether the child control is a
repo picker, branch action menu, file action menu, or future sidebar control.

## Non-Goals

- Do not move every row or picker popover into centralized app overlay state.
- Do not make transient parents know about specific child controls.
- Do not fix anchor stability by eagerly closing child menus on parent leave.
- Do not replace custom transient parents with a Radix primitive solely to get
  hover behavior; custom parents may own sizing, animation retention, inert
  state, title-bar behavior, and resize interaction.

## Accessibility

Pinning is a dismissal policy, not a focus policy.

- Focus remains governed by the child floating primitive and its trigger.
- Escape and outside-click behavior remain governed by the child primitive.
- Focus restoration should continue to follow the child primitive's behavior.
- App-level dialogs triggered from menus may outlive the transient parent only
  when their state is intentionally centralized.

## Testing Requirements

Tests for this pattern should cover both the primitive and a concrete parent:

- an open `Popover` under a `FloatingSurfaceBoundary` pins the boundary;
- closing the `Popover` unpins the boundary;
- unmounting an open `Popover` unpins the boundary;
- multiple open descendants keep the boundary pinned until all close;
- the transient parent suppresses ambient auto-close while pinned;
- the transient parent resumes ambient auto-close after unpinning;
- without descendant surfaces, existing close-on-leave behavior is unchanged.

Prefer tests that assert observable behavior: pinned UI remains mounted and
interactive, child surfaces close normally, and ambient close behavior resumes
after unpinning.
