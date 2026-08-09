// Vue Testing Library owns Vue's mount lifecycle; this helper adds the
// repository cleanup boundary because Vitest globals are disabled.
import { cleanup, render } from '@testing-library/vue'
import type { RenderOptions, RenderResult } from '@testing-library/vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import type { QueryClient } from '@tanstack/vue-query'
import { defineComponent, isVNode, nextTick, shallowRef } from 'vue'
import type { Component, ComponentOptions, ShallowRef, VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach } from 'vitest'
import {
  consumeAppHistoryPresentationAction,
  createAppHistoryPresentationHistory,
} from '#/web/app-history-presentation.ts'
import { appI18n } from '#/web/stores/i18n-vue.ts'

afterEach(cleanup)

type JsxComponent = Exclude<Component, ComponentOptions>

export interface JsdomRenderOptions extends Omit<RenderOptions<unknown>, 'wrapper'> {
  wrapper?: JsxComponent
}

export interface ComponentJsdomRenderOptions extends Omit<JsdomRenderOptions, 'wrapper'> {
  wrapper?: never
}

export interface JsdomRenderResult extends Omit<RenderResult, 'baseElement' | 'container' | 'rerender'> {
  baseElement: HTMLElement
  container: HTMLElement
  flushAnimationFrames(frames?: number): Promise<void>
  rerender(next: VNode | Record<string, unknown>): Promise<void>
}

async function flushAnimationFrames(frames = 1): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

export function renderInJsdom(component: VNode, options?: JsdomRenderOptions): JsdomRenderResult
export function renderInJsdom(component: Component, options?: ComponentJsdomRenderOptions): JsdomRenderResult
export function renderInJsdom(
  component: Component | VNode,
  options: JsdomRenderOptions | ComponentJsdomRenderOptions = {},
): JsdomRenderResult {
  const { wrapper: Wrapper, ...renderOptions } = options
  if (!isVNode(component) && Wrapper) {
    throw new Error('component renders do not accept wrapper; render a VNode when a wrapper is required')
  }
  const suppliedPlugins = renderOptions.global?.plugins ?? []
  const router = suppliedPlugins.some(isRouterPlugin) ? null : createTestRouter()
  const global = {
    ...renderOptions.global,
    plugins: [appI18n, ...(router ? [router] : []), ...suppliedPlugins],
  }

  if (!isVNode(component)) {
    const mounted = render(component, { ...renderOptions, global })
    return {
      ...mounted,
      baseElement: mounted.baseElement as HTMLElement,
      container: mounted.container as HTMLElement,
      flushAnimationFrames,
      rerender: async (next) => {
        if (isVNode(next)) throw new Error('component renders accept prop objects when rerendering')
        await mounted.rerender(next)
      },
    }
  }

  const content = shallowRef(component)
  const Harness = defineComponent({
    name: 'VNodeTestHarness',
    inheritAttrs: false,
    setup() {
      return () => {
        if (!Wrapper) return content.value
        const TestWrapper = Wrapper
        return <TestWrapper>{content.value}</TestWrapper>
      }
    },
  })
  const mounted = render(Harness, { ...renderOptions, global })
  return {
    ...mounted,
    baseElement: mounted.baseElement as HTMLElement,
    container: mounted.container as HTMLElement,
    flushAnimationFrames,
    rerender: async (next) => {
      if (!isVNode(next)) throw new Error('VNode renders must be rerendered with a VNode')
      if (next === content.value) {
        throw new Error('VNode renders must be rerendered with a newly created VNode')
      }
      content.value = next
      await nextTick()
    },
  }
}

function isRouterPlugin(pluginWithOptions: unknown): boolean {
  const plugin = Array.isArray(pluginWithOptions) ? pluginWithOptions[0] : pluginWithOptions
  return typeof plugin === 'object' && plugin !== null && 'currentRoute' in plugin && 'resolve' in plugin
}

function createTestRouter() {
  const history = createAppHistoryPresentationHistory(createMemoryHistory())
  const router = createRouter({
    history,
    routes: [
      {
        path: '/:pathMatch(.*)*',
        component: defineComponent({
          name: 'TestRouterRoute',
          inheritAttrs: false,
          setup() {
            return () => null
          },
        }),
      },
    ],
  })
  const removeInitialPresentation = router.afterEach((_to, _from, failure) => {
    if (failure) return
    consumeAppHistoryPresentationAction(history)
    removeInitialPresentation()
  })
  return router
}

export function renderComposableInJsdom<T>(
  composable: () => T,
  options: JsdomRenderOptions = {},
): JsdomRenderResult & { result: ShallowRef<T> } {
  const result = shallowRef<T>() as ShallowRef<T>
  const Harness = defineComponent({
    name: 'ComposableTestHarness',
    inheritAttrs: false,
    setup() {
      result.value = composable()
      return () => null
    },
  })
  return { ...renderInJsdom(<Harness />, options), result }
}

export async function flushTestUpdates<T>(callback: () => T | Promise<T>): Promise<T> {
  const result = await callback()
  await nextTick()
  return result
}

export function vueQueryRenderOptions(queryClient: QueryClient): Pick<JsdomRenderOptions, 'global'> {
  return {
    global: {
      plugins: [[VueQueryPlugin, { queryClient }]],
    },
  }
}
