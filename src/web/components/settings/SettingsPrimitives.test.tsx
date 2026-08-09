// @vitest-environment jsdom

import { Moon } from '@lucide/vue'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { SettingsSelect } from '#/web/components/settings/SettingsPrimitives.tsx'

describe('SettingsSelect', () => {
  test('preserves the selected option icon and label in the trigger', () => {
    const { container } = renderInJsdom(
      <SettingsSelect
        id="settings-test-select"
        value="dark"
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark', icon: Moon },
        ]}
        onChange={vi.fn()}
      />,
    )

    const value = container.querySelector<HTMLElement>('#settings-test-select [data-slot="select-value"]')
    const icon = value?.querySelector<SVGElement>('svg.lucide-moon')
    expect(value?.textContent).toBe('Dark')
    expect(icon).not.toBeNull()
    expect(icon?.classList.contains('size-4')).toBe(true)
  })
})
