# Vue Development

Use Vue as a typed projection layer over the project's authoritative models.
Keep component contracts explicit, ownership local, and rendering declarative.

## Component contracts

- Render UI in TSX. `.vue` SFCs and the `h(...)` render helper are outside the
  project conventions, including tests, fixtures, and examples.
- Name component-primary files after the component in PascalCase, such as
  `SelectValue.tsx`. Use `class` in JSX and explicit units for CSS lengths;
  numbers are reserved for genuinely unitless values.
- Use object-form `defineComponent` for components with setup state,
  composables, or lifecycle. Pure render-only components may use the explicit
  `FunctionalComponent` type; do not introduce a project-wide `FC` alias.
- Keep one clear props type source. Domain components normally use
  `defineComponent<Props>`; option-heavy primitives may infer from a runtime
  props object with `PropType`. TypeScript types are erased, so register each
  owned setup prop at runtime. Use a name array when Vue only needs to separate
  props from attrs, and object options for runtime required checks, Boolean
  casting, defaults, or validation. Transparent adapters may leave open
  platform props in attrs. Required domain inputs remain required and non-null.
- Use `emits` for Vue model and event protocols. Use a typed callback prop when
  the caller provides an application capability or its outcome is part of the
  contract; do not expose the same interaction through both forms.
- Treat slots as lazy render contracts: invoke them in the render function, and
  use scoped slots when the child owns the rendered state.
- Treat fallthrough attrs as public behavior. A single-root component may
  intentionally rely on Vue's default fallthrough. For multiple roots or
  redirected or rejected attrs, use `inheritAttrs: false` and either reject
  them explicitly or forward them to one chosen owner. Values that drive
  behavior are props, not attrs.

```tsx
import { defineComponent } from 'vue'

interface WorkspaceCardProps {
  name: string
  path: string
  onOpen: () => void
}

export const WorkspaceCard = defineComponent<WorkspaceCardProps>({
  name: 'WorkspaceCard',
  props: ['name', 'path', 'onOpen'],
  setup(props) {
    return () => (
      <button type="button" onClick={props.onOpen}>
        <strong>{props.name}</strong>
        <span>{props.path}</span>
      </button>
    )
  },
})
```

## Reactivity and lifetime

- Keep props reactive by reading `props.x`, passing a getter, or using `toRef`
  or `computed`; do not snapshot them through plain destructuring or
  `ref(props.x)` in `setup`. Prefer derivation over mirrored local state.
- Create component-owned composables and watchers synchronously at the top
  level of `setup` so the component scope owns them. Keep the returned function
  focused on rendering.
- Use watchers for imperative projection or resource lifetimes, not as a
  workaround for unclear data flow. Inputs and ownership must be stable, and
  subscriptions, requests, timers, DOM integrations, and other work that can
  outlive a watcher run must be invalidated or cleaned up.
- DOM-reading and animation effects must establish their required commit and
  frame boundaries explicitly; watcher flush timing is part of the contract.
- Capture the accepted target of an asynchronous action before yielding. A
  later route or prop change must not redirect work already in progress.
- Express conditional ownership with component lifetime instead of nullable
  identities, mirrored state, or compensating effects.

## Architecture and tests

- Reuse existing feature-owned boundaries. Vue integration must not create a
  second authority for the same fact.
- Follow [the testing strategy](testing.md). Await Vue updates and verify
  observable behavior, ownership changes, invalidation, and cleanup.
