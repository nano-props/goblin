import { describe, expect, test } from 'vitest'
import { shouldPauseRealtimeRequest } from '#/server/terminal/terminal-runtime-realtime.ts'

describe('terminal realtime handlers', () => {
  test('pauses every externally supported authoritative terminal frame request, including takeover', () => {
    expect(shouldPauseRealtimeRequest('attach')).toBe(true)
    expect(shouldPauseRealtimeRequest('restart')).toBe(true)
    expect(shouldPauseRealtimeRequest('takeover')).toBe(true)
    expect(shouldPauseRealtimeRequest('resize')).toBe(false)
  })
})
