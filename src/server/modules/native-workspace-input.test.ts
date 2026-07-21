import { describe, expect, test } from 'vitest'
import {
  formatNativeDirectorySuggestion,
  nativeLeafMatches,
  planNativeDirectorySuggestions,
  workspaceLocatorFromNativeCommandInput,
} from '#/server/modules/native-workspace-input.ts'

describe('native workspace input', () => {
  test.each([
    ['/', { searchRoot: '/', typedLeaf: '', displayMode: 'absolute' }],
    ['/fo', { searchRoot: '/', typedLeaf: 'fo', displayMode: 'absolute' }],
    ['/srv/', { searchRoot: '/srv/', typedLeaf: '', displayMode: 'absolute' }],
    ['~', { searchRoot: '/home/example', typedLeaf: '', displayMode: 'home-relative' }],
    ['~/Dev', { searchRoot: '/home/example', typedLeaf: 'Dev', displayMode: 'home-relative' }],
  ])('plans POSIX prefix %s', (prefix, expected) => {
    expect(planNativeDirectorySuggestions(prefix, 'posix', '/home/example')).toMatchObject(expected)
  })

  test.each([
    ['C:\\', { searchRoot: 'C:\\', typedLeaf: '', displayMode: 'absolute' }],
    ['C:\\Dev\\re', { searchRoot: 'C:\\Dev', typedLeaf: 're', displayMode: 'absolute' }],
    ['~\\Dev', { searchRoot: 'C:\\Users\\example', typedLeaf: 'Dev', displayMode: 'home-relative' }],
  ])('plans Windows prefix %s', (prefix, expected) => {
    expect(planNativeDirectorySuggestions(prefix, 'win32', 'C:\\Users\\example')).toMatchObject(expected)
  })

  test.each(['relative', 'goblin+file:///tmp/repo', '/tmp/../repo', '/tmp//repo', 'C:\\repo'])(
    'rejects unsupported POSIX suggestion input %s',
    (prefix) => expect(planNativeDirectorySuggestions(prefix, 'posix', '/home/example')).toBeNull(),
  )

  test.each(['relative', '\\\\server\\share', 'c:\\repo', 'C:/repo', 'C:\\tmp\\..\\repo'])(
    'rejects unsupported Windows suggestion input %s',
    (prefix) => expect(planNativeDirectorySuggestions(prefix, 'win32', 'C:\\Users\\example')).toBeNull(),
  )

  test('formats home-relative suggestions without adding a separator', () => {
    const plan = planNativeDirectorySuggestions('~/De', 'posix', '/home/example')!
    expect(formatNativeDirectorySuggestion(plan, 'Developer')).toBe('~/Developer')
  })

  test('uses platform case policy while preserving actual names', () => {
    expect(nativeLeafMatches('Developer', 'dev', 'posix')).toBe(false)
    expect(nativeLeafMatches('Developer', 'dev', 'win32')).toBe(true)
  })

  test('shares tilde expansion with final workspace admission', () => {
    expect(workspaceLocatorFromNativeCommandInput('~/Developer/repo', 'posix', '/home/example')).toBe(
      'goblin+file:///home/example/Developer/repo',
    )
  })
})
