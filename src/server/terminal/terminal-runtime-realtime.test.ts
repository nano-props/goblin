import { describe, expect, test } from 'vitest'
import { shouldPauseRealtimeRequest } from '#/server/terminal/terminal-runtime-realtime.ts'

describe('createTerminalRealtimeHandlers', () => {
  test('pauses every authoritative terminal frame request, including takeover', () => {
    expect(shouldPauseRealtimeRequest('attach')).toBe(true)
    expect(shouldPauseRealtimeRequest('restart')).toBe(true)
    expect(shouldPauseRealtimeRequest('create')).toBe(true)
    expect(shouldPauseRealtimeRequest('takeover')).toBe(true)
    expect(shouldPauseRealtimeRequest('slot-snapshot')).toBe(false)
    expect(shouldPauseRealtimeRequest('resize')).toBe(false)
  })
})
